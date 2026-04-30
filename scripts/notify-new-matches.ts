/**
 * Daily Cron: „Neue Inserate für meine Suche"-Benachrichtigung.
 *
 * Pro aktivem search_profile mit notify_new_matches=true und gesetzter user_id:
 *   1. match_listings_for_profile() ziehen (Top 50, RPC enthält Hard-Filter)
 *   2. nur Listings behalten, deren listings.created_at > last_notified_at
 *      (= seit der letzten Mail neu reingekommen)
 *   3. Wenn ≥1 neuer Treffer: Email an auth.users.email schicken
 *      (Resend, Template lib/email/templates/new-matches.ts)
 *   4. notification_log-Zeile schreiben (status=sent|failed|skipped)
 *   5. last_notified_at auf NOW() setzen — auch bei „nichts Neues",
 *      sonst läuft das Fenster unkontrolliert auf.
 *
 * Idempotency: last_notified_at wird sofort nach dem Send gesetzt. Wenn das
 * Script crasht, *bevor* der Send erfolgte → nächster Run sendet (gut).
 * Wenn es crasht *zwischen* Send und Update → Doppel-Mail im nächsten Run
 * (Risiko akzeptiert, max. 1× / Tag).
 *
 * Voraussetzungen (.env.local oder GitHub Secrets):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - RESEND_API_KEY
 *   - RESEND_FROM_ADDRESS
 *   - NEXT_PUBLIC_BASE_URL  (z.B. https://home4u.ai — für Listing-Links)
 *
 * Aufruf:
 *   node --env-file=.env.local --import tsx scripts/notify-new-matches.ts
 *   node --env-file=.env.local --import tsx scripts/notify-new-matches.ts --dry
 *   node --env-file=.env.local --import tsx scripts/notify-new-matches.ts --profile <uuid>
 *
 * Optionen:
 *   --dry                 Keine Mails, kein DB-Write — nur loggen, was passieren würde
 *   --limit <n>           Max. Anzahl Inserate pro Mail (Default 8)
 *   --profile <uuid>      Nur dieses eine Profil prüfen (lokales Testen)
 *   --max-profiles <n>    Insgesamt max. N Profile bearbeiten (Safety-Net beim Erstlauf)
 */
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../lib/email/send";
import {
  buildNewMatchesEmail,
  type NewMatchItem,
} from "../lib/email/templates/new-matches";

type Opts = {
  dryRun: boolean;
  limitPerMail: number;
  onlyProfileId: string | null;
  maxProfiles: number;
};

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    dryRun: false,
    limitPerMail: 8,
    onlyProfileId: null,
    maxProfiles: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") opts.dryRun = true;
    else if (a === "--limit") {
      opts.limitPerMail = Math.max(1, Math.min(20, parseInt(argv[++i], 10) || 8));
    } else if (a === "--profile") {
      opts.onlyProfileId = argv[++i];
    } else if (a === "--max-profiles") {
      opts.maxProfiles = Math.max(1, Math.min(5000, parseInt(argv[++i], 10) || 500));
    }
  }
  return opts;
}

type ProfileRow = {
  id: string;
  user_id: string;
  location: string;
  type: "rent" | "sale";
  last_notified_at: string;
};

type MatchRow = {
  listing_id: string;
  type: "rent" | "sale";
  title: string | null;
  location_city: string | null;
  location_district: string | null;
  price: number | null;
  currency: string | null;
  rooms: number | null;
  size_sqm: number | null;
  media: string[] | null;
};

type ProfileResult = {
  profile_id: string;
  user_id: string;
  status: "sent" | "skipped_no_new" | "skipped_no_email" | "failed";
  match_count: number;
  reason?: string;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[notify] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nicht gesetzt");
    process.exit(1);
  }

  const baseUrlRaw =
    process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL ?? "https://home4u.ai";
  const baseUrl = baseUrlRaw.startsWith("http") ? baseUrlRaw : `https://${baseUrlRaw}`;

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Aktive User-Profile mit Notify-Flag laden
  let q = supabase
    .from("search_profiles")
    .select("id, user_id, location, type, last_notified_at")
    .eq("active", true)
    .eq("notify_new_matches", true)
    .not("user_id", "is", null)
    .order("last_notified_at", { ascending: true })
    .limit(opts.maxProfiles);
  if (opts.onlyProfileId) q = q.eq("id", opts.onlyProfileId);

  const { data: profiles, error: profilesErr } = await q;
  if (profilesErr) {
    console.error("[notify] profiles load failed", profilesErr);
    process.exit(1);
  }

  console.log(`[notify] ${profiles?.length ?? 0} Profile zu prüfen (dryRun=${opts.dryRun})`);

  const results: ProfileResult[] = [];
  for (const p of (profiles ?? []) as ProfileRow[]) {
    try {
      const r = await processProfile(supabase, baseUrl, p, opts);
      results.push(r);
      console.log(
        `[notify] profile=${p.id} user=${p.user_id} status=${r.status} matches=${r.match_count}${r.reason ? ` reason=${r.reason}` : ""}`
      );
    } catch (e) {
      console.error(`[notify] profile=${p.id} threw`, e);
      results.push({
        profile_id: p.id,
        user_id: p.user_id,
        status: "failed",
        match_count: 0,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log("[notify] summary", summary);
}

async function processProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  baseUrl: string,
  profile: ProfileRow,
  opts: Opts
): Promise<ProfileResult> {
  // 2) Top-Matches via RPC (gleicher Hard-Filter wie /matches im Dashboard)
  const { data: matchesData, error: matchesErr } = await supabase.rpc(
    "match_listings_for_profile",
    {
      p_profile_id: profile.id,
      p_limit: 50,
    }
  );
  if (matchesErr) {
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "failed",
      match_count: 0,
      reason: `match_rpc:${matchesErr.message}`,
    };
  }
  const matches = (matchesData ?? []) as MatchRow[];
  if (matches.length === 0) {
    await touchLastNotifiedAt(supabase, profile.id, opts.dryRun);
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "skipped_no_new",
      match_count: 0,
      reason: "no_matches",
    };
  }

  // 3) Welche Listings sind NEU (created_at > last_notified_at)?
  const ids = matches.map((m) => m.listing_id);
  const { data: createdRows, error: createdErr } = await supabase
    .from("listings")
    .select("id, created_at")
    .in("id", ids)
    .gt("created_at", profile.last_notified_at);
  if (createdErr) {
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "failed",
      match_count: 0,
      reason: `created_lookup:${createdErr.message}`,
    };
  }
  const newIdSet = new Set(((createdRows ?? []) as { id: string }[]).map((r) => r.id));
  const newMatches = matches.filter((m) => newIdSet.has(m.listing_id)).slice(0, opts.limitPerMail);

  if (newMatches.length === 0) {
    await touchLastNotifiedAt(supabase, profile.id, opts.dryRun);
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "skipped_no_new",
      match_count: 0,
    };
  }

  // 4) User-Email holen
  const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(profile.user_id);
  if (userErr || !userData?.user?.email) {
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "skipped_no_email",
      match_count: newMatches.length,
      reason: userErr?.message ?? "no_email",
    };
  }
  const email = userData.user.email;

  // 5) Mail bauen + senden
  const items: NewMatchItem[] = newMatches.map((m) => ({
    id: m.listing_id,
    title: m.title,
    type: m.type,
    price: m.price != null ? Number(m.price) : null,
    currency: m.currency,
    city: m.location_city,
    district: m.location_district,
    rooms: m.rooms,
    sizeSqm: m.size_sqm,
    coverUrl: m.media?.[0] ?? null,
  }));

  const { subject, html, text } = buildNewMatchesEmail({
    baseUrl,
    searchLocation: profile.location,
    searchType: profile.type,
    matches: items,
    language: "de",
  });

  if (opts.dryRun) {
    console.log(`[notify] dry — würde Mail an ${email} senden, subject="${subject}"`);
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "sent",
      match_count: newMatches.length,
      reason: "dry_run",
    };
  }

  const sendResult = await sendEmail({
    to: email,
    subject,
    html,
    text,
    tags: [
      { name: "kind", value: "new_matches_digest" },
      { name: "profile_id", value: profile.id },
    ],
  });

  // 6) Loggen + last_notified_at aktualisieren
  if (!sendResult.ok) {
    await supabase.from("notification_log").insert({
      profile_id: profile.id,
      user_id: profile.user_id,
      channel: "email",
      listing_ids: newMatches.map((m) => m.listing_id),
      status: sendResult.reason === "not_configured" ? "skipped" : "failed",
      error_message: sendResult.reason === "not_configured"
        ? "resend_not_configured"
        : sendResult.error ?? "send_failed",
    });
    return {
      profile_id: profile.id,
      user_id: profile.user_id,
      status: "failed",
      match_count: newMatches.length,
      reason: sendResult.reason,
    };
  }

  await supabase.from("notification_log").insert({
    profile_id: profile.id,
    user_id: profile.user_id,
    channel: "email",
    listing_ids: newMatches.map((m) => m.listing_id),
    status: "sent",
  });
  await touchLastNotifiedAt(supabase, profile.id, false);

  return {
    profile_id: profile.id,
    user_id: profile.user_id,
    status: "sent",
    match_count: newMatches.length,
  };
}

async function touchLastNotifiedAt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  profileId: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  const { error } = await supabase
    .from("search_profiles")
    .update({ last_notified_at: new Date().toISOString() })
    .eq("id", profileId);
  if (error) console.error(`[notify] touch last_notified_at failed for ${profileId}`, error);
}

main().catch((e) => {
  console.error("[notify] fatal", e);
  process.exit(1);
});

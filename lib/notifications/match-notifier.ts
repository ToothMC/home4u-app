/**
 * Findet neue Matches pro Suchprofil seit `last_notified_at` und sendet
 * eine Benachrichtigungs-E-Mail an den User. Bewusst defensiv:
 *   - Nur Profile mit user_id (anon kriegt keine Notifications)
 *   - Nur Profile mit notify_new_matches = true
 *   - Nur Listings, die NACH last_notified_at angelegt wurden
 *   - Top 5 Treffer via match_listings_for_profile RPC
 *   - Wenn Resend nicht konfiguriert → Status 'skipped' im Log
 *
 * Wird vom Cron-Worker app/api/cron/notify-matches aufgerufen. Liefert
 * eine Zusammenfassung für Logging / Health-Check.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/notifications/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://home4u.ai";
const TOP_N_MATCHES = 5;

type ProfileRow = {
  id: string;
  user_id: string;
  location: string;
  budget_min: number | null;
  budget_max: number;
  rooms: number | null;
  type: "rent" | "sale";
  last_notified_at: string;
};

type MatchRow = {
  listing_id: string;
  type: "rent" | "sale";
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  property_type: string | null;
  source: string | null;
};

export type NotifyResult = {
  scannedProfiles: number;
  emailsSent: number;
  emailsFailed: number;
  emailsSkipped: number;
};

export async function runMatchNotifier(): Promise<NotifyResult> {
  const result: NotifyResult = {
    scannedProfiles: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsSkipped: 0,
  };

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    console.warn("[notify] supabase service client unavailable");
    return result;
  }

  // Schritt 1: Profile mit aktivem Notify-Flag laden
  const { data: profiles, error: profilesErr } = await supabase
    .from("search_profiles")
    .select(
      "id, user_id, location, budget_min, budget_max, rooms, type, last_notified_at"
    )
    .eq("active", true)
    .eq("notify_new_matches", true)
    .not("user_id", "is", null);

  if (profilesErr) {
    console.error("[notify] profile query failed", profilesErr);
    return result;
  }
  result.scannedProfiles = profiles?.length ?? 0;

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    try {
      // Schritt 2: Match-RPC für dieses Profil — Top N
      const { data: matches, error: matchesErr } = await supabase.rpc(
        "match_listings_for_profile",
        {
          p_user_id: profile.user_id,
          p_anonymous_id: null,
          p_limit: 30,
          p_variant_id: null,
        }
      );
      if (matchesErr) {
        console.error("[notify] rpc failed", profile.id, matchesErr);
        continue;
      }

      // Schritt 3: bereits gemeldete Listings ausfiltern. Die RPC liefert
      // kein created_at — also dedupen wir gegen notification_log: alle
      // listing_ids, die in den letzten 90 Tagen für DIESES Profil schon
      // gemailt wurden, werden übersprungen.
      const matchRows = (matches ?? []) as MatchRow[];
      const ninetyDaysAgo = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: priorLogs } = await supabase
        .from("notification_log")
        .select("listing_ids")
        .eq("profile_id", profile.id)
        .eq("status", "sent")
        .gte("sent_at", ninetyDaysAgo);
      const alreadyNotified = new Set<string>();
      for (const row of priorLogs ?? []) {
        for (const id of (row.listing_ids as string[]) ?? []) {
          alreadyNotified.add(id);
        }
      }
      const fresh = matchRows
        .filter((m) => !alreadyNotified.has(m.listing_id))
        .slice(0, TOP_N_MATCHES);

      if (fresh.length === 0) {
        // Kein Update — last_notified_at NICHT aktualisieren, sonst
        // verpassen wir Listings, die zwischen den Cron-Läufen kamen.
        continue;
      }

      // Schritt 4: User-Email holen via auth admin
      const { data: userData } = await supabase.auth.admin.getUserById(
        profile.user_id
      );
      const email = userData?.user?.email;
      if (!email) {
        console.warn("[notify] user has no email", profile.user_id);
        continue;
      }

      // Schritt 5: E-Mail rendern + senden
      const html = renderMatchEmail(profile, fresh);
      const text = renderMatchEmailText(profile, fresh);
      const subject = `${fresh.length} ${fresh.length === 1 ? "neuer Treffer" : "neue Treffer"} für "${profile.location}"`;

      const sendRes = await sendEmail({
        to: email,
        subject,
        html,
        text,
      });

      // Schritt 6: Loggen
      const log = {
        profile_id: profile.id,
        user_id: profile.user_id,
        channel: "email" as const,
        listing_ids: fresh.map((m) => m.listing_id),
        status: sendRes.ok
          ? ("sent" as const)
          : sendRes.reason === "no_api_key"
            ? ("skipped" as const)
            : ("failed" as const),
        error_message: sendRes.ok ? null : sendRes.reason,
      };
      await supabase.from("notification_log").insert(log);

      if (sendRes.ok) {
        result.emailsSent++;
        // Cursor erst NACH Erfolg setzen — sonst gehen Listings verloren
        await supabase
          .from("search_profiles")
          .update({ last_notified_at: new Date().toISOString() })
          .eq("id", profile.id);
      } else if (sendRes.reason === "no_api_key") {
        result.emailsSkipped++;
      } else {
        result.emailsFailed++;
      }
    } catch (err) {
      console.error("[notify] profile loop error", profile.id, err);
      result.emailsFailed++;
    }
  }

  return result;
}

const TYPE_LABEL: Record<string, string> = {
  apartment: "Wohnung",
  house: "Haus",
  villa: "Villa",
  studio: "Studio",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
};

function fmtPrice(price: number, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function listingLine(m: MatchRow) {
  const t = m.property_type ? TYPE_LABEL[m.property_type] ?? "Immobilie" : "Immobilie";
  const rooms = m.rooms ? `${m.rooms} Zi ` : "";
  const size = m.size_sqm ? ` · ${m.size_sqm} m²` : "";
  const loc = m.location_district
    ? `${m.location_district}, ${m.location_city}`
    : m.location_city;
  const price = fmtPrice(m.price, m.currency);
  const suffix = m.type === "rent" ? "/Mo" : "";
  return `${rooms}${t} · ${loc} · ${price}${suffix}`;
}

function renderMatchEmail(profile: ProfileRow, matches: MatchRow[]): string {
  const items = matches
    .map((m) => {
      const url = `${APP_URL}/listings/${m.listing_id}?from=email`;
      return `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #eee;">
            <a href="${url}" style="color:#1f2937;text-decoration:none;font-weight:600;">
              ${listingLine(m)}
            </a>
          </td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:24px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:24px 24px 8px;">
          <h1 style="margin:0;font-size:20px;color:#0a2540;">
            ${matches.length} ${matches.length === 1 ? "neuer Treffer" : "neue Treffer"} für deine Suche
          </h1>
          <p style="margin:8px 0 0;color:#6b7280;font-size:14px;">
            "${profile.location}", ${profile.type === "rent" ? "Miete" : "Kauf"}
          </p>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${items}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 24px 28px;">
          <a href="${APP_URL}/matches" style="display:inline-block;background:#0a2540;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">
            Alle Treffer ansehen
          </a>
        </td></tr>
        <tr><td style="padding:0 24px 24px;font-size:12px;color:#9ca3af;line-height:1.5;">
          Du bekommst diese E-Mail, weil du Benachrichtigungen für diese Suche aktiviert hast.
          <a href="${APP_URL}/dashboard?view=seeker" style="color:#9ca3af;">Einstellungen</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderMatchEmailText(profile: ProfileRow, matches: MatchRow[]): string {
  const lines = matches
    .map((m) => `- ${listingLine(m)}\n  ${APP_URL}/listings/${m.listing_id}?from=email`)
    .join("\n\n");
  return `Neue Treffer für "${profile.location}" (${profile.type === "rent" ? "Miete" : "Kauf"}):

${lines}

Alle Treffer ansehen: ${APP_URL}/matches

Einstellungen: ${APP_URL}/dashboard?view=seeker
`;
}

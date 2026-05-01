/**
 * Trigger-Mail „Owner bietet dir eine Wohnung an" — wird best-effort von
 * der /api/gesuche/[id]/offer-Route aufgerufen, nachdem die RPC den Match
 * angelegt hat.
 *
 * Kein blockierender Pfad — wenn Resend down ist oder der Sucher anonym
 * (kein user_id im search_profile, was im RPC eigentlich nicht passieren
 * sollte aber sicherheitshalber abgedeckt), loggen wir nur. Der Sucher
 * sieht das Angebot trotzdem im Dashboard wenn er eingeloggt ist.
 *
 * Logging in notification_log (channel='email', source='owner_offer') —
 * gleiche Tabelle wie der notify-new-matches-Cron.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { buildOwnerOfferEmail } from "@/lib/email/templates/owner-offer";

type Args = {
  matchId: string;
  searchProfileId: string;
  ownerListingId: string;
  ownerUserId: string;
};

export async function sendOwnerOfferEmail(args: Args): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    console.warn("[owner-offer] supabase not configured — skip");
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai";

  // Sucher-Profil + zugehörige user_id
  const { data: profile, error: profileErr } = await supabase
    .from("search_profiles")
    .select("user_id, location, type")
    .eq("id", args.searchProfileId)
    .maybeSingle();
  if (profileErr || !profile) {
    console.warn("[owner-offer] profile lookup failed", profileErr);
    return;
  }
  if (!profile.user_id) {
    // Anonyme Profile sollten gar nicht published_as_wanted=true sein
    // (PATCH-Route clamped das), aber zur Sicherheit kein Send.
    console.warn("[owner-offer] profile has no user_id — skip", args.searchProfileId);
    return;
  }

  // Sucher-Email aus auth.users via Admin-API
  const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(
    profile.user_id
  );
  if (userErr || !userRes?.user?.email) {
    console.warn("[owner-offer] user email lookup failed", userErr);
    return;
  }
  const seekerEmail = userRes.user.email;

  // Listing-Daten für Preview im Mail
  const { data: listing, error: listingErr } = await supabase
    .from("listings")
    .select("title, location_city, location_district, price, currency, rooms, size_sqm, media")
    .eq("id", args.ownerListingId)
    .maybeSingle();
  if (listingErr || !listing) {
    console.warn("[owner-offer] listing lookup failed", listingErr);
    return;
  }

  const coverUrl =
    Array.isArray(listing.media) && listing.media.length > 0
      ? (listing.media[0] as string)
      : null;

  const { subject, html, text } = buildOwnerOfferEmail({
    baseUrl,
    matchId: args.matchId,
    seekerLocation: profile.location,
    seekerType: profile.type as "rent" | "sale",
    listing: {
      title: listing.title,
      city: listing.location_city,
      district: listing.location_district,
      price: listing.price ? Number(listing.price) : null,
      currency: listing.currency,
      rooms: listing.rooms,
      sizeSqm: listing.size_sqm,
      coverUrl,
    },
  });

  const result = await sendEmail({
    to: seekerEmail,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: "owner_offer" },
      { name: "match_id", value: args.matchId },
    ],
  });

  // notification_log persistieren — gleiches Schema wie notify-new-matches.
  // status=sent | failed | skipped, error_message hält Resend-msg-id (siehe
  // chore/notify-log-resend-msgid Konvention) bei sent, sonst Fehler.
  try {
    await supabase.from("notification_log").insert({
      user_id: profile.user_id,
      profile_id: args.searchProfileId,
      channel: "email",
      listing_ids: [args.ownerListingId],
      status: result.ok ? "sent" : "failed",
      error_message: result.ok
        ? `resend_msg_id=${result.messageId}`
        : `${result.reason}${result.error ? `: ${result.error}` : ""}`,
    });
  } catch (e) {
    console.warn("[owner-offer] notification_log insert failed", e);
  }

  if (result.ok) {
    console.info(
      `[owner-offer] sent → ${seekerEmail} (resend_msg_id=${result.messageId}, match=${args.matchId})`
    );
  } else {
    console.warn(`[owner-offer] send failed`, result);
  }
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchChatThread } from "@/components/match-browse/MatchChatThread";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Owner-Anfragen-Detail-Page: zeigt Seeker-Profil + In-App-Chat.
 *
 * Auth: nur Listing-Owner darf seine eigenen Anfragen sehen. Service-Role-
 * Client für Lookups (RLS-Bypass war hier schon Pattern in /matches/[id]).
 */
export default async function OwnerAnfrageDetailPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;

  const user = await getAuthUser();
  if (!user) {
    redirect(`/?auth=required&next=/dashboard/anfragen/${matchId}`);
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) redirect("/dashboard");

  const { t } = await getT();

  const { data: match, error } = await supabase
    .from("matches")
    .select(
      `id, listing_id, search_profile_id, seeker_user_id, seeker_anonymous_id,
       seeker_interest, seeker_decided_at, owner_interest, owner_decided_at, connected_at,
       listings!inner (
         id, title, type, location_city, location_district, price, currency,
         rooms, size_sqm, media, status, owner_user_id
       )`
    )
    .eq("id", matchId)
    .maybeSingle();

  if (error || !match) {
    notFound();
  }

  const listing = match.listings as unknown as {
    id: string;
    title: string | null;
    type: "rent" | "sale";
    location_city: string;
    location_district: string | null;
    price: number;
    currency: string;
    rooms: number | null;
    size_sqm: number | null;
    media: string[] | null;
    status: string;
    owner_user_id: string | null;
  };

  if (listing.owner_user_id !== user.id) {
    redirect("/dashboard");
  }

  // Seeker-Profil laden (optional — kann NULL sein)
  let seekerProfile: {
    location: string | null;
    budget_min: number | null;
    budget_max: number | null;
    rooms: number | null;
    move_in_date: string | null;
    household: string | null;
    free_text: string | null;
    email: string | null;
  } | null = null;

  if (match.search_profile_id) {
    const { data: sp } = await supabase
      .from("search_profiles")
      .select(
        "location, budget_min, budget_max, rooms, move_in_date, household, free_text, user_id"
      )
      .eq("id", match.search_profile_id)
      .maybeSingle();
    let email: string | null = null;
    if (sp?.user_id) {
      try {
        const { data: u } = await supabase.auth.admin.getUserById(sp.user_id);
        email = u?.user?.email ?? null;
      } catch {
        email = null;
      }
    }
    seekerProfile = sp
      ? {
          location: sp.location,
          budget_min: sp.budget_min,
          budget_max: sp.budget_max,
          rooms: sp.rooms,
          move_in_date: sp.move_in_date,
          household: sp.household,
          free_text: sp.free_text,
          email,
        }
      : null;
  }

  const counterpartyLabel = seekerProfile?.email
    ? seekerProfile.email
    : t("ownerAnfrage.seekerFallback");

  const listingDesc = [
    listing.location_district
      ? `${listing.location_city} · ${listing.location_district}`
      : listing.location_city,
    listing.rooms != null ? `${listing.rooms} Zi` : null,
    listing.size_sqm ? `${listing.size_sqm} m²` : null,
    `${Number(listing.price).toLocaleString("de-DE")} ${listing.currency || "EUR"}${listing.type === "rent" ? "/mo" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard?view=provider"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> {t("dashDetail.listings.back")}
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t("ownerAnfrage.heading")}</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {listing.title ?? listingDesc}
          </p>
        </div>

        {seekerProfile && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t("ownerAnfrage.seekerHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {seekerProfile.location && (
                <p>
                  <span className="text-[var(--muted-foreground)]">
                    {t("ownerAnfrage.location")}:{" "}
                  </span>
                  {seekerProfile.location}
                </p>
              )}
              {(seekerProfile.budget_min || seekerProfile.budget_max) && (
                <p>
                  <span className="text-[var(--muted-foreground)]">
                    {t("ownerAnfrage.budget")}:{" "}
                  </span>
                  {seekerProfile.budget_min ?? "?"} – {seekerProfile.budget_max ?? "?"} {listing.currency}
                </p>
              )}
              {seekerProfile.rooms != null && (
                <p>
                  <span className="text-[var(--muted-foreground)]">
                    {t("ownerAnfrage.rooms")}:{" "}
                  </span>
                  {seekerProfile.rooms}
                </p>
              )}
              {seekerProfile.household && (
                <p>
                  <span className="text-[var(--muted-foreground)]">
                    {t("ownerAnfrage.household")}:{" "}
                  </span>
                  {seekerProfile.household}
                </p>
              )}
              {seekerProfile.free_text && (
                <p className="italic text-[var(--muted-foreground)] pt-1">
                  &bdquo;{seekerProfile.free_text}&ldquo;
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {match.connected_at ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t("ownerAnfrage.chatHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MatchChatThread
                matchId={match.id}
                counterpartyLabel={counterpartyLabel}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-4 text-sm text-[var(--muted-foreground)]">
              {t("ownerAnfrage.notConnectedYet")}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

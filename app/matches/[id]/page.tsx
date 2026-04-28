import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Handshake, MailIcon, Loader2, Clock } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchCard, type MatchCardData } from "@/components/match-browse/MatchCard";
import { WithdrawRequestButton } from "@/components/match-browse/WithdrawRequestButton";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Status = "waiting" | "rejected" | "connected";

function deriveStatus(row: {
  owner_interest: boolean | null;
  connected_at: string | null;
}): Status {
  if (row.connected_at) return "connected";
  if (row.owner_interest === false) return "rejected";
  return "waiting";
}

function formatDateRel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `vor ${h} h`;
  const days = Math.floor(h / 24);
  return `vor ${days} Tagen`;
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  const session = user ? null : await getOrCreateAnonymousSession();

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    redirect("/dashboard");
  }

  // Match + Listing + Profil-Owner laden
  const { data: match, error } = await supabase
    .from("matches")
    .select(
      `id, search_profile_id, listing_id, owner_interest, connected_at,
       seeker_decided_at, owner_decided_at,
       search_profiles!inner ( user_id, anonymous_id ),
       listings!inner (
         id, type, location_city, location_district, price, currency,
         rooms, size_sqm, media, status, contact_channel, owner_user_id,
         scam_score, scam_flags, market_position
       )`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !match) {
    notFound();
  }

  // Authorisierung: nur Eigentümer des Suchprofils darf hier rein
  const profile = (match.search_profiles as unknown) as {
    user_id: string | null;
    anonymous_id: string | null;
  };
  const isOwnerByUser = user && profile.user_id === user.id;
  const isOwnerByAnon =
    session?.anonymousId && profile.anonymous_id === session.anonymousId;
  if (!isOwnerByUser && !isOwnerByAnon) {
    redirect("/matches");
  }

  const listing = (match.listings as unknown) as {
    id: string;
    type: "rent" | "sale";
    location_city: string;
    location_district: string | null;
    price: number;
    currency: string;
    rooms: number | null;
    size_sqm: number | null;
    media: string[] | null;
    status: string;
    contact_channel: string | null;
    owner_user_id: string | null;
    scam_score: number | null;
    scam_flags: string[] | null;
    market_position: string | null;
  };
  const status = deriveStatus(match);

  // Owner-Email nur bei connected — Service-Role kann auth.admin nutzen
  let ownerEmail: string | null = null;
  if (status === "connected" && listing.owner_user_id) {
    try {
      const { data: ownerData } = await supabase.auth.admin.getUserById(
        listing.owner_user_id
      );
      ownerEmail = ownerData?.user?.email ?? null;
    } catch (err) {
      console.error("[match-detail] owner email lookup failed", err);
    }
  }

  const cardData: MatchCardData = {
    id: listing.id,
    type: listing.type,
    location_city: listing.location_city,
    location_district: listing.location_district,
    price: Number(listing.price),
    currency: listing.currency,
    rooms: listing.rooms,
    size_sqm: listing.size_sqm,
    media: listing.media,
    score: 1, // im Detail-View nicht relevant
    scamScore: listing.scam_score,
    scamFlags: listing.scam_flags,
    marketPosition:
      (listing.market_position as MatchCardData["marketPosition"]) ?? null,
  };

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard?view=seeker"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-md w-full px-4 pt-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Deine Anfrage</h1>
          <StatusLine
            status={status}
            decidedAt={match.seeker_decided_at}
            ownerDecidedAt={match.owner_decided_at}
          />
        </div>

        {/* Fixed-Höhe-Wrapper: MatchCard nutzt intern h-full + flex und braucht
            einen begrenzten Container, sonst kollabiert sie auf Mobile zu 0px
            (Bild verschwindet) bzw. expandiert ungehemmt auf Desktop. Aspect 3/4
            gibt eine Foto-typische Höhe; max-h-[80dvh] schützt Desktop. */}
        <div className="aspect-[3/4] max-h-[80dvh] w-full">
          <MatchCard data={cardData} />
        </div>

        {status === "connected" && ownerEmail && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Handshake className="size-4" /> Verbunden
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="text-[var(--muted-foreground)]">
                Beide Seiten sind dran. Schreib direkt:
              </p>
              <p className="flex items-center gap-1 font-medium">
                <MailIcon className="size-4" /> {ownerEmail}
              </p>
              {listing.contact_channel && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Bevorzugter Kanal: {listing.contact_channel}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {status === "waiting" && (
          <Card>
            <CardContent className="py-4 text-sm text-[var(--muted-foreground)] flex items-center gap-2">
              <Clock className="size-4" />
              Wir warten auf die Bestätigung. Du wirst hier informiert sobald
              der Anbieter reagiert.
            </CardContent>
          </Card>
        )}

        {status === "rejected" && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="py-4 text-sm">
              Der Anbieter hat abgelehnt. Sophie sucht weiter — du findest
              andere Treffer im{" "}
              <Link href="/matches" className="underline">
                Match-Browser
              </Link>
              .
            </CardContent>
          </Card>
        )}

        <div className="pt-2 flex flex-col gap-2">
          {status !== "rejected" && (
            <WithdrawRequestButton matchId={match.id} />
          )}
          <Button asChild variant="outline">
            <Link href="/matches">Weitere Treffer ansehen</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function StatusLine({
  status,
  decidedAt,
  ownerDecidedAt,
}: {
  status: Status;
  decidedAt: string | null;
  ownerDecidedAt: string | null;
}) {
  const sentAgo = formatDateRel(decidedAt);
  const ownerAgo = formatDateRel(ownerDecidedAt);
  return (
    <p className="text-xs text-[var(--muted-foreground)] mt-1">
      {status === "connected" ? (
        <>
          Verbunden{ownerAgo ? ` · ${ownerAgo}` : ""}
        </>
      ) : status === "rejected" ? (
        <>Abgelehnt{ownerAgo ? ` · ${ownerAgo}` : ""}</>
      ) : (
        <>
          Anfrage gesendet{sentAgo ? ` · ${sentAgo}` : ""}
          <Loader2 className="inline size-3 ml-1 animate-spin opacity-60" />
        </>
      )}
    </p>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Handshake,
  Mail,
  MapPin,
  PawPrint,
  Sparkles,
  Users2,
} from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import {
  MatchCard,
  type MatchCardData,
} from "@/components/match-browse/MatchCard";
import { RespondMatchButtons } from "@/components/dashboard/RespondMatchButtons";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Status = "pending" | "accepted" | "rejected" | "connected";

function deriveStatus(row: {
  owner_interest: boolean | null;
  connected_at: string | null;
}): Status {
  if (row.connected_at) return "connected";
  if (row.owner_interest === true) return "accepted";
  if (row.owner_interest === false) return "rejected";
  return "pending";
}

export default async function OwnerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/?auth=required&next=/dashboard/requests/${id}`);
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) redirect("/dashboard");

  const { data: match, error } = await supabase
    .from("matches")
    .select(
      `id, search_profile_id, listing_id, owner_interest, connected_at,
       seeker_decided_at, owner_decided_at,
       search_profiles!inner (
         id, location, budget_min, budget_max, rooms, household,
         move_in_date, lifestyle_tags, pets, free_text, user_id
       ),
       listings!inner (
         id, type, location_city, location_district, price, currency,
         rooms, size_sqm, media, contact_channel, owner_user_id,
         scam_score, scam_flags, market_position
       )`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !match) {
    notFound();
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
    contact_channel: string | null;
    owner_user_id: string | null;
    scam_score: number | null;
    scam_flags: string[] | null;
    market_position: string | null;
  };

  // Auth: nur der Listing-Owner darf die Detail-Page sehen
  if (listing.owner_user_id !== user.id) {
    redirect("/dashboard");
  }

  const profile = (match.search_profiles as unknown) as {
    id: string;
    location: string;
    budget_min: number | null;
    budget_max: number | null;
    rooms: number | null;
    household: string | null;
    move_in_date: string | null;
    lifestyle_tags: string[] | null;
    pets: boolean | null;
    free_text: string | null;
    user_id: string | null;
  };

  const status = deriveStatus(match);

  // Seeker-Email nur bei connected
  let seekerEmail: string | null = null;
  if (status === "connected" && profile.user_id) {
    try {
      const { data } = await supabase.auth.admin.getUserById(profile.user_id);
      seekerEmail = data?.user?.email ?? null;
    } catch (err) {
      console.error("[request-detail] seeker email lookup failed", err);
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
    score: 1,
    scamScore: listing.scam_score,
    scamFlags: listing.scam_flags,
    marketPosition:
      (listing.market_position as MatchCardData["marketPosition"]) ?? null,
  };

  const budgetLabel = formatBudget(profile.budget_min, profile.budget_max);
  const householdMap: Record<string, string> = {
    single: "Einzelperson",
    couple: "Paar",
    family: "Familie",
    shared: "WG",
  };

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard?view=provider#match-inbox"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Anfragen
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl w-full px-4 pt-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Anfrage für dein Inserat</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {status === "connected"
              ? "Verbunden — schreib direkt"
              : status === "accepted"
                ? "Du hast zugesagt — wir warten auf den Suchenden"
                : status === "rejected"
                  ? "Du hast abgelehnt"
                  : "Eingegangen, wartet auf deine Antwort"}
          </p>
        </div>

        {/* Fixed-Höhe-Wrapper analog /matches/[id] — MatchCard braucht
            begrenzten Container (sonst Mobile=0px, Desktop=ungehemmt). */}
        <div className="aspect-[3/4] max-h-[80dvh] w-full">
          <MatchCard data={cardData} />
        </div>

        {/* Seeker-Profil */}
        <article className="rounded-xl border bg-[var(--card)] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-base font-semibold">
              {(seekerEmail ?? "?")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {status === "connected" && seekerEmail
                  ? seekerEmail
                  : "Suchender"}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1 truncate">
                <MapPin className="size-3" /> sucht in {profile.location}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {profile.rooms != null && (
              <Detail label="Zimmer" value={`${profile.rooms} Zi`} />
            )}
            {budgetLabel && <Detail label="Budget" value={budgetLabel} />}
            {profile.household && (
              <Detail
                label="Haushalt"
                icon={<Users2 className="size-3" />}
                value={householdMap[profile.household] ?? profile.household}
              />
            )}
            {profile.move_in_date && (
              <Detail
                label="Einzug"
                icon={<CalendarDays className="size-3" />}
                value={new Date(profile.move_in_date).toLocaleDateString("de-DE")}
              />
            )}
            {profile.pets != null && (
              <Detail
                label="Haustiere"
                icon={<PawPrint className="size-3" />}
                value={profile.pets ? "ja" : "nein"}
              />
            )}
          </div>

          {profile.lifestyle_tags && profile.lifestyle_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {profile.lifestyle_tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--accent)] border px-2 py-0.5 text-[11px]"
                >
                  <Sparkles className="inline size-2.5 mr-0.5" /> {tag}
                </span>
              ))}
            </div>
          )}

          {profile.free_text && (
            <p className="text-sm italic text-[var(--muted-foreground)] border-l-2 pl-3">
              &bdquo;{profile.free_text}&ldquo;
            </p>
          )}
        </article>

        {/* Action area */}
        <div className="pt-2">
          {status === "connected" && seekerEmail && (
            <a
              href={`mailto:${seekerEmail}`}
              className="flex items-center justify-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium h-14"
            >
              <Mail className="size-4" /> Kontakt aufnehmen
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                <Handshake className="size-3" /> verbunden
              </span>
            </a>
          )}
          {status === "rejected" && (
            <p className="rounded-md border bg-[var(--accent)] p-3 text-xs text-[var(--muted-foreground)] text-center">
              Du hast diese Anfrage abgelehnt — der Suchende sieht das in
              seiner Outbox.
            </p>
          )}
          {status === "accepted" && !match.connected_at && (
            <p className="rounded-md border bg-emerald-50/60 p-3 text-xs text-[var(--muted-foreground)] text-center">
              Du hast zugesagt. Sobald der Suchende es bestätigt, wird der
              Kontakt freigeschaltet.
            </p>
          )}
          {status === "pending" && <RespondMatchButtons matchId={match.id} />}
        </div>
      </section>
    </main>
  );
}

function Detail({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="text-sm flex items-center gap-1">
        {icon}
        {value}
      </div>
    </div>
  );
}

function formatBudget(min: number | null, max: number | null): string | null {
  if (!max) return null;
  if (min && min > 0) {
    return `${Number(min).toLocaleString("de-DE")}–${Number(max).toLocaleString("de-DE")} €`;
  }
  return `bis ${Number(max).toLocaleString("de-DE")} €`;
}

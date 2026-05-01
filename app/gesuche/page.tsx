// Public-Liste „Such-Inserate" — anonymisierte Karten von Sucher-Profilen,
// die ihren Toggle published_as_wanted=true gesetzt haben.
//
// Datenschutz:
//   - Keine user_id, kein Display-Name, keine Email — auch nicht im
//     Server-Component-Render (RPC list_wanted_profiles ist Spalten-Whitelist).
//   - Sucher kann den Toggle jederzeit ausschalten → Profil verschwindet sofort
//     (RPC filtert auf published_as_wanted=true UND active=true).
//
// Kontakt-Pfad:
//   - Owner klickt eine Karte → /gesuche/[id] mit „Wohnung anbieten"-Picker.
//   - Picker zeigt nur Owner-eigene aktive Listings vom passenden Type.
//   - Submit ruft owner_offer_to_seeker-RPC → Match mit owner_interest=true.
//   - Sucher sieht die Anfrage in seinem bestehenden Matches-Inbox + bekommt
//     eine Trigger-Mail „Du hast ein neues Wohnungs-Angebot" via Resend.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, MapPin, Bed, Wallet, PawPrint, Users2 } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type WantedProfile = {
  id: string;
  type: "rent" | "sale";
  property_type: string | null;
  location: string;
  budget_min: number | null;
  budget_max: number;
  currency: string;
  rooms: number | null;
  rooms_strict: boolean | null;
  household: string | null;
  lifestyle_tags: string[] | null;
  pets: boolean | null;
  free_text: string | null;
  move_in_date: string | null;
  wanted_published_at: string | null;
};

const HOUSEHOLD_LABEL: Record<string, string> = {
  single: "Einzelperson",
  couple: "Paar",
  family: "Familie",
  shared: "WG",
};

function formatBudget(min: number | null, max: number, currency: string): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  if (min && min > 0) return `${fmt(min)} – ${fmt(max)}`;
  return `bis ${fmt(max)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return "heute";
  if (days < 2) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 30) return `vor ${Math.floor(days / 7)} Wochen`;
  return `vor ${Math.floor(days / 30)} Monaten`;
}

export default async function GesuchePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; city?: string }>;
}) {
  // Auth-Gate: Such-Inserate sind nur für eingeloggte User sichtbar.
  // Verhindert anonymes Scraping der Sucher-Profile + macht klar, dass die
  // ganze Plattform inkl. Wanted-Ads ein Logged-in-Kontext ist (Owner-Offer
  // funktioniert eh nur eingeloggt, also wäre Public-View wertlos für
  // Conversion).
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required&next=/gesuche");
  }

  const params = await searchParams;
  const filterType = params.type === "rent" || params.type === "sale" ? params.type : null;
  const filterCity = (params.city ?? "").trim() || null;

  const supabase = createSupabaseServiceClient();
  let profiles: WantedProfile[] = [];
  let loadError: string | null = null;

  if (!supabase) {
    loadError = "Supabase nicht konfiguriert";
  } else {
    const { data, error } = await supabase.rpc("list_wanted_profiles", {
      p_limit: 100,
      p_offset: 0,
      p_type: filterType,
      p_city: filterCity,
    });
    if (error) {
      console.error("[gesuche] list_wanted_profiles failed", error);
      loadError = error.message;
    } else {
      profiles = (data ?? []) as WantedProfile[];
    }
  }

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Home
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Such-Inserate</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Menschen, die eine Wohnung in Zypern suchen — wie die
            {" "}&bdquo;ich suche&ldquo;-Sparte in der Zeitung. Bietest du
            etwas Passendes an, kannst du sie über Home4U direkt
            kontaktieren — ihre Email bleibt unsichtbar.
          </p>
        </div>

        <form className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-[var(--muted-foreground)]">Filter:</span>
          <Link
            href="/gesuche"
            className={`rounded-full border px-3 py-1 transition-colors ${
              !filterType ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            alle
          </Link>
          <Link
            href="/gesuche?type=rent"
            className={`rounded-full border px-3 py-1 transition-colors ${
              filterType === "rent" ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            Miete
          </Link>
          <Link
            href="/gesuche?type=sale"
            className={`rounded-full border px-3 py-1 transition-colors ${
              filterType === "sale" ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            Kauf
          </Link>
          <input
            type="text"
            name="city"
            defaultValue={filterCity ?? ""}
            placeholder="Stadt-Filter"
            className="rounded-full border px-3 py-1 text-sm bg-white"
          />
          <button type="submit" className="rounded-full bg-[var(--foreground)] text-[var(--background)] px-3 py-1 text-sm">
            anwenden
          </button>
        </form>

        {loadError ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            Konnte Such-Inserate nicht laden: {loadError}
          </div>
        ) : profiles.length === 0 ? (
          <div className="rounded-md border bg-[var(--muted)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
            Aktuell keine veröffentlichten Such-Inserate{filterType || filterCity ? " mit diesem Filter" : ""}.
          </div>
        ) : (
          <ul className="space-y-3">
            {profiles.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/gesuche/${p.id}`}
                  className="block rounded-md border bg-white px-4 py-3 hover:border-[var(--foreground)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${
                          p.type === "rent" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        }`}>
                          {p.type === "rent" ? "sucht zur Miete" : "sucht zum Kauf"}
                        </span>
                        {p.property_type ? (
                          <span className="text-[var(--muted-foreground)]">
                            · {p.property_type}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="size-4 text-[var(--muted-foreground)]" />
                        <span>{p.location}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                        <span className="inline-flex items-center gap-1">
                          <Wallet className="size-3.5" />
                          {formatBudget(p.budget_min, p.budget_max, p.currency)}
                        </span>
                        {p.rooms ? (
                          <span className="inline-flex items-center gap-1">
                            <Bed className="size-3.5" />
                            {p.rooms}{p.rooms_strict ? "" : "+"} Zimmer
                          </span>
                        ) : null}
                        {p.household ? (
                          <span className="inline-flex items-center gap-1">
                            <Users2 className="size-3.5" />
                            {HOUSEHOLD_LABEL[p.household] ?? p.household}
                          </span>
                        ) : null}
                        {p.pets ? (
                          <span className="inline-flex items-center gap-1">
                            <PawPrint className="size-3.5" /> Haustier
                          </span>
                        ) : null}
                      </div>
                      {p.free_text ? (
                        <p className="text-sm text-[var(--muted-foreground)] mt-1 line-clamp-2">
                          &bdquo;{p.free_text}&ldquo;
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                      {formatRelative(p.wanted_published_at)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

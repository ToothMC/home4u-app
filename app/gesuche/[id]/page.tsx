// Detail-Page eines Such-Inserats. Anonymisierter Profil-Block + Picker, mit
// dem ein eingeloggter Owner eines seiner aktiven Listings als Angebot
// schicken kann. Owner-Picker-Daten kommen direkt aus dem RPC
// get_wanted_profile (eligible_listings filtert auf caller-owned + active +
// passender Type).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Wallet, Bed, PawPrint, Users2, CalendarDays } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { OfferToSeekerPicker } from "@/components/wanted/OfferToSeekerPicker";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProfileRow = {
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

type EligibleListing = {
  id: string;
  title: string | null;
  location_city: string | null;
  location_district: string | null;
  price: number | null;
  currency: string | null;
  rooms: number | null;
  size_sqm: number | null;
  property_type: string | null;
  cover_url: string | null;
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

export default async function GesucheDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();

  // Wenn eingeloggt: Server-Client damit auth.uid() im RPC sichtbar ist und
  // eligible_listings korrekt befüllt wird. Sonst Service-Client (eligible
  // bleibt leer Array — kein Picker für anonyme Besucher).
  let supabase;
  try {
    supabase = user ? await createSupabaseServerClient() : createSupabaseServiceClient();
  } catch {
    supabase = createSupabaseServiceClient();
  }
  if (!supabase) notFound();

  const { data, error } = await supabase.rpc("get_wanted_profile", { p_id: id });
  if (error || !data || (data as { ok?: boolean }).ok !== true) {
    notFound();
  }
  const payload = data as {
    ok: true;
    profile: ProfileRow;
    eligible_listings: EligibleListing[];
  };
  const p = payload.profile;
  const eligible = payload.eligible_listings ?? [];

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/gesuche"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Zurück zu Such-Inseraten
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-5">
        <div className="rounded-md border bg-white px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
              p.type === "rent" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}>
              {p.type === "rent" ? "sucht zur Miete" : "sucht zum Kauf"}
            </span>
            {p.property_type ? (
              <span className="text-sm text-[var(--muted-foreground)]">
                {p.property_type}
              </span>
            ) : null}
          </div>

          <h1 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="size-5 text-[var(--muted-foreground)]" />
            {p.location}
          </h1>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center gap-1.5">
              <Wallet className="size-4 text-[var(--muted-foreground)]" />
              <dt className="text-[var(--muted-foreground)]">Budget</dt>
              <dd className="font-medium">{formatBudget(p.budget_min, p.budget_max, p.currency)}</dd>
            </div>
            {p.rooms ? (
              <div className="flex items-center gap-1.5">
                <Bed className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">Zimmer</dt>
                <dd className="font-medium">{p.rooms}{p.rooms_strict ? " (genau)" : "+"}</dd>
              </div>
            ) : null}
            {p.household ? (
              <div className="flex items-center gap-1.5">
                <Users2 className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">Haushalt</dt>
                <dd className="font-medium">{HOUSEHOLD_LABEL[p.household] ?? p.household}</dd>
              </div>
            ) : null}
            {p.move_in_date ? (
              <div className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">Einzug ab</dt>
                <dd className="font-medium">{new Date(p.move_in_date).toLocaleDateString("de-DE")}</dd>
              </div>
            ) : null}
            {p.pets ? (
              <div className="flex items-center gap-1.5">
                <PawPrint className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">Haustier</dt>
                <dd className="font-medium">ja</dd>
              </div>
            ) : null}
          </dl>

          {p.lifestyle_tags && p.lifestyle_tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.lifestyle_tags.map((t) => (
                <span key={t} className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {p.free_text ? (
            <div className="border-t pt-3">
              <h2 className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                Persönliche Notiz
              </h2>
              <p className="text-sm whitespace-pre-line">&bdquo;{p.free_text}&ldquo;</p>
            </div>
          ) : null}
        </div>

        {!user ? (
          <div className="rounded-md border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <Link href={`/?auth=required&next=/gesuche/${p.id}`} className="font-medium underline">
              Melde dich an
            </Link>
            {" "}um diesem Sucher eine deiner Wohnungen anzubieten. Email
            bleibt für beide Seiten unsichtbar — Kontakt läuft ausschließlich
            über das Home4U-Postfach.
          </div>
        ) : eligible.length === 0 ? (
          <div className="rounded-md border bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            Du hast noch kein aktives Inserat vom Typ &bdquo;{p.type === "rent" ? "Miete" : "Verkauf"}&ldquo;.
            Lege erst eines an um dieses Such-Inserat zu beantworten.{" "}
            <Link href="/dashboard?view=provider" className="underline">Inserat anlegen</Link>
          </div>
        ) : (
          <OfferToSeekerPicker profileId={p.id} listings={eligible} />
        )}
      </section>
    </main>
  );
}

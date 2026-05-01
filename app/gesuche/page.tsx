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
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

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

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

function formatBudget(
  min: number | null,
  max: number,
  currency: string,
  lang: SupportedLang,
  t: T,
): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat(NUMBER_LOCALE[lang], {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  if (min && min > 0) return `${fmt(min)} – ${fmt(max)}`;
  return `${t("common.budgetUpTo")} ${fmt(max)}`;
}

function formatRelative(iso: string | null, t: T): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return t("common.relative.today");
  if (days < 2) return t("common.relative.yesterday");
  if (days < 7) return tFormat(t("common.relative.daysAgo"), { n: days });
  if (days < 30) return tFormat(t("common.relative.weeksAgo"), { n: Math.floor(days / 7) });
  return tFormat(t("common.relative.monthsAgo"), { n: Math.floor(days / 30) });
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

  const { t, lang } = await getT();
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
          <ArrowLeft className="size-4" /> {t("common.home")}
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t("wanted.heading")}</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {t("wanted.subtitle")}
          </p>
        </div>

        <form className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-[var(--muted-foreground)]">{t("wanted.filter")}</span>
          <Link
            href="/gesuche"
            className={`rounded-full border px-3 py-1 transition-colors ${
              !filterType ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            {t("wanted.filter.all")}
          </Link>
          <Link
            href="/gesuche?type=rent"
            className={`rounded-full border px-3 py-1 transition-colors ${
              filterType === "rent" ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            {t("wanted.filter.rent")}
          </Link>
          <Link
            href="/gesuche?type=sale"
            className={`rounded-full border px-3 py-1 transition-colors ${
              filterType === "sale" ? "bg-[var(--foreground)] text-[var(--background)]" : "hover:bg-[var(--muted)]"
            }`}
          >
            {t("wanted.filter.sale")}
          </Link>
          <input
            type="text"
            name="city"
            defaultValue={filterCity ?? ""}
            placeholder={t("wanted.filter.cityPlaceholder")}
            className="rounded-full border px-3 py-1 text-sm bg-white"
          />
          <button type="submit" className="rounded-full bg-[var(--foreground)] text-[var(--background)] px-3 py-1 text-sm">
            {t("wanted.filter.apply")}
          </button>
        </form>

        {loadError ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("wanted.error")}: {loadError}
          </div>
        ) : profiles.length === 0 ? (
          <div className="rounded-md border bg-[var(--muted)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
            {t("wanted.empty")}{filterType || filterCity ? t("wanted.empty.withFilter") : ""}.
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
                          {p.type === "rent" ? t("wanted.card.rent") : t("wanted.card.sale")}
                        </span>
                        {p.property_type ? (
                          <span className="text-[var(--muted-foreground)]">
                            · {t((`property.${p.property_type}`) as TKey) || p.property_type}
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
                          {formatBudget(p.budget_min, p.budget_max, p.currency, lang, t)}
                        </span>
                        {p.rooms ? (
                          <span className="inline-flex items-center gap-1">
                            <Bed className="size-3.5" />
                            {p.rooms}{p.rooms_strict ? "" : "+"} {t("wanted.card.rooms")}
                          </span>
                        ) : null}
                        {p.household ? (
                          <span className="inline-flex items-center gap-1">
                            <Users2 className="size-3.5" />
                            {householdLabel(p.household, t)}
                          </span>
                        ) : null}
                        {p.pets ? (
                          <span className="inline-flex items-center gap-1">
                            <PawPrint className="size-3.5" /> {t("wanted.card.pet")}
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
                      {formatRelative(p.wanted_published_at, t)}
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

function householdLabel(value: string, t: T): string {
  switch (value) {
    case "single":
      return t("household.single");
    case "couple":
      return t("household.couple");
    case "family":
      return t("household.family");
    case "shared":
      return t("household.shared");
    default:
      return value;
  }
}

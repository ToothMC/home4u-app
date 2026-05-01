import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, Wallet, Bed, PawPrint, Users2, CalendarDays } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { OfferToSeekerPicker } from "@/components/wanted/OfferToSeekerPicker";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

export const dynamic = "force-dynamic";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

const HOUSEHOLD_KEY: Record<string, TKey> = {
  single: "household.single",
  couple: "household.couple",
  family: "household.family",
  shared: "household.shared",
};

const PROPERTY_TYPE_KEY: Record<string, TKey> = {
  apartment: "property.apartment",
  house: "property.house",
  villa: "property.villa",
  maisonette: "property.maisonette",
  studio: "property.studio",
  townhouse: "property.townhouse",
  penthouse: "property.penthouse",
  bungalow: "property.bungalow",
  land: "property.land",
  commercial: "property.commercial",
};

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

export default async function GesucheDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/?auth=required&next=/gesuche/${id}`);
  }

  const { t, lang } = await getT();

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
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

  const propertyTypeLabel = p.property_type
    ? PROPERTY_TYPE_KEY[p.property_type]
      ? t(PROPERTY_TYPE_KEY[p.property_type])
      : p.property_type
    : null;
  const householdLabel = p.household
    ? HOUSEHOLD_KEY[p.household]
      ? t(HOUSEHOLD_KEY[p.household])
      : p.household
    : null;

  const typeLabel = p.type === "rent" ? t("searchEditor.type.rent") : t("searchEditor.type.sale");

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/gesuche"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> {t("wantedDetail.back")}
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-5">
        <div className="rounded-md border bg-white px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
              p.type === "rent" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}>
              {p.type === "rent" ? t("wanted.card.rent") : t("wanted.card.sale")}
            </span>
            {propertyTypeLabel ? (
              <span className="text-sm text-[var(--muted-foreground)]">
                {propertyTypeLabel}
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
              <dt className="text-[var(--muted-foreground)]">{t("wantedDetail.budget")}</dt>
              <dd className="font-medium">{formatBudget(p.budget_min, p.budget_max, p.currency, lang, t)}</dd>
            </div>
            {p.rooms ? (
              <div className="flex items-center gap-1.5">
                <Bed className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">{t("wantedDetail.rooms")}</dt>
                <dd className="font-medium">{p.rooms}{p.rooms_strict ? t("wantedDetail.roomsExact") : "+"}</dd>
              </div>
            ) : null}
            {householdLabel ? (
              <div className="flex items-center gap-1.5">
                <Users2 className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">{t("wantedDetail.household")}</dt>
                <dd className="font-medium">{householdLabel}</dd>
              </div>
            ) : null}
            {p.move_in_date ? (
              <div className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">{t("wantedDetail.moveIn")}</dt>
                <dd className="font-medium">{new Date(p.move_in_date).toLocaleDateString(NUMBER_LOCALE[lang])}</dd>
              </div>
            ) : null}
            {p.pets ? (
              <div className="flex items-center gap-1.5">
                <PawPrint className="size-4 text-[var(--muted-foreground)]" />
                <dt className="text-[var(--muted-foreground)]">{t("wantedDetail.pet")}</dt>
                <dd className="font-medium">{t("wantedDetail.petYes")}</dd>
              </div>
            ) : null}
          </dl>

          {p.lifestyle_tags && p.lifestyle_tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.lifestyle_tags.map((tag) => (
                <span key={tag} className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {p.free_text ? (
            <div className="border-t pt-3">
              <h2 className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                {t("wantedDetail.note")}
              </h2>
              <p className="text-sm whitespace-pre-line">&bdquo;{p.free_text}&ldquo;</p>
            </div>
          ) : null}
        </div>

        {eligible.length === 0 ? (
          <div className="rounded-md border bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            {tFormat(t("wantedDetail.noActiveListing"), { type: typeLabel })}{" "}
            <Link href="/dashboard?view=provider" className="underline">
              {t("wantedDetail.createListing")}
            </Link>
          </div>
        ) : (
          <OfferToSeekerPicker profileId={p.id} listings={eligible} />
        )}
      </section>
    </main>
  );
}

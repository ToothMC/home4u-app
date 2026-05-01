import {
  CalendarDays,
  DoorClosed,
  Maximize,
  Wallet,
  Shield,
  Building,
  Zap,
  FileSignature,
} from "lucide-react";
import type { PublicListingData } from "./types";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

const UTILITY_KEY: Record<string, TKey> = {
  tenant_pays: "utilities.tenantPays",
  included: "utilities.included",
  landlord_pays: "utilities.landlordPays",
  estimated: "utilities.estimated",
  not_provided: "utilities.notProvided",
};

export async function QuickFactsBar({ listing }: { listing: PublicListingData }) {
  const { t, lang } = await getT();
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];

  facts.push({
    icon: <Wallet className="size-4" />,
    label: listing.type === "rent" ? t("facts.rentPerMonth") : t("facts.salePrice"),
    value: formatPrice(listing.price, listing.currency, listing.type, lang, t),
  });

  if (listing.size_sqm) {
    facts.push({
      icon: <Maximize className="size-4" />,
      label: t("facts.size"),
      value: `${listing.size_sqm} m²`,
    });
  }
  if (listing.rooms != null) {
    facts.push({
      icon: <DoorClosed className="size-4" />,
      label: t("facts.rooms"),
      value:
        listing.rooms === 0
          ? t("listing.fallbackTitle.studio")
          : String(listing.rooms),
    });
  }
  facts.push({
    icon: <CalendarDays className="size-4" />,
    label: t("facts.availability"),
    value: listing.available_from
      ? tFormat(t("facts.fromDate"), {
          date: new Date(listing.available_from).toLocaleDateString(NUMBER_LOCALE[lang]),
        })
      : t("facts.immediate"),
  });
  if (listing.deposit) {
    facts.push({
      icon: <Shield className="size-4" />,
      label: t("facts.deposit"),
      value: formatPrice(listing.deposit, listing.currency, "rent", lang, t),
    });
  }
  if (listing.service_charge_monthly) {
    facts.push({
      icon: <Building className="size-4" />,
      label: t("facts.serviceCharge"),
      value: formatPrice(listing.service_charge_monthly, listing.currency, "rent", lang, t),
    });
  }
  if (listing.utilities?.estimated_monthly_total) {
    facts.push({
      icon: <Zap className="size-4" />,
      label: t("facts.utilitiesPerMonth"),
      value: `~${formatPrice(listing.utilities.estimated_monthly_total, listing.currency, "rent", lang, t)}`,
    });
  }
  if (listing.type === "rent" && listing.contract_min_months != null) {
    facts.push({
      icon: <FileSignature className="size-4" />,
      label: t("facts.minTerm"),
      value:
        listing.contract_min_months === 0
          ? t("facts.flexible")
          : listing.contract_min_months === 12
            ? t("facts.oneYear")
            : listing.contract_min_months === 24
              ? t("facts.twoYears")
              : `${listing.contract_min_months} ${t("facts.monthsShort")}`,
    });
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">{t("facts.heading")}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {facts.map((f, i) => (
          <div
            key={i}
            className="rounded-xl border bg-[var(--card)] px-4 py-3 flex items-start gap-3"
          >
            <div className="shrink-0 size-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-[var(--muted-foreground)]">
              {f.icon}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {f.label}
              </div>
              <div className="text-sm font-semibold">{f.value}</div>
            </div>
          </div>
        ))}
      </div>

      {listing.utilities && hasUtilityInfo(listing.utilities) && (
        <UtilitiesNote utilities={listing.utilities} t={t} />
      )}

      {listing.contract_notes && (
        <div className="mt-3 rounded-xl border bg-[var(--card)] px-4 py-3 text-sm">
          <div className="font-semibold text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
            {t("facts.contractDetails")}
          </div>
          <p className="text-sm">{listing.contract_notes}</p>
        </div>
      )}
    </section>
  );
}

function hasUtilityInfo(u: PublicListingData["utilities"]): boolean {
  if (!u) return false;
  return Boolean(
    u.water ||
      u.electricity ||
      u.internet ||
      u.garbage ||
      u.bills_in_tenant_name != null ||
      u.notes
  );
}

function utilityValue(raw: string, t: T): string {
  const key = UTILITY_KEY[raw];
  return key ? t(key) : raw;
}

function UtilitiesNote({
  utilities,
  t,
}: {
  utilities: NonNullable<PublicListingData["utilities"]>;
  t: T;
}) {
  const items: { label: string; value: string }[] = [];
  if (utilities.electricity)
    items.push({ label: t("utilities.electricity"), value: utilityValue(utilities.electricity, t) });
  if (utilities.water)
    items.push({ label: t("utilities.water"), value: utilityValue(utilities.water, t) });
  if (utilities.internet)
    items.push({ label: t("utilities.internet"), value: utilityValue(utilities.internet, t) });
  if (utilities.garbage)
    items.push({ label: t("utilities.garbage"), value: utilityValue(utilities.garbage, t) });

  return (
    <div id="costs" className="mt-3 rounded-xl border bg-[var(--card)] px-4 py-3 space-y-2 text-sm">
      <div className="font-semibold text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
        {t("utilities.heading")}
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {items.map((i) => (
            <div key={i.label}>
              <div className="text-[10px] text-[var(--muted-foreground)]">{i.label}</div>
              <div className="text-sm">{i.value}</div>
            </div>
          ))}
        </div>
      )}
      {utilities.bills_in_tenant_name != null && (
        <div className="text-xs text-[var(--muted-foreground)]">
          {utilities.bills_in_tenant_name
            ? t("utilities.tenantContracts")
            : t("utilities.landlordContracts")}
        </div>
      )}
      {utilities.notes && (
        <div className="text-xs italic text-[var(--muted-foreground)]">{utilities.notes}</div>
      )}
    </div>
  );
}

function formatPrice(
  amount: number,
  currency: string,
  type: "rent" | "sale",
  lang: SupportedLang,
  t: T,
) {
  const fmt = new Intl.NumberFormat(NUMBER_LOCALE[lang], {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
  return type === "rent" ? `${fmt} ${t("facts.perMonthShort")}` : fmt;
}

import { ExternalLink } from "lucide-react";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildSourceUrl } from "@/lib/listings/source-url";
import { getT } from "@/lib/i18n/server";
import { tFormat } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

const SOURCE_LABELS: Record<string, string> = {
  bazaraki: "Bazaraki",
  index_cy: "INDEX.cy",
  cyprus_real_estate: "Cyprus-Real.Estate",
  fb: "Facebook",
  direct: "Home4U",
  other: "—",
};

type Offer = {
  listing_id: string;
  source: string;
  external_id: string | null;
  price: number;
  currency: string;
  contact_channel: string | null;
  is_canonical: boolean;
  last_seen?: string;
  days_since_seen?: number;
};

export async function ClusterOffersBlock({
  canonicalListingId,
}: {
  canonicalListingId: string;
}) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_cluster_offers", {
    p_canonical_id: canonicalListingId,
  });
  if (error || !data) return null;

  const offers = data as Offer[];
  if (offers.length < 2) return null;

  const { t, lang } = await getT();
  const otherCount = offers.length - 1;

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold">
          {otherCount === 1
            ? t("cluster.alsoAvailableFromOne")
            : tFormat(t("cluster.alsoAvailableFrom"), { n: otherCount })}
        </h2>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {t("cluster.subtitle")}
        </p>
      </div>
      <div className="space-y-2">
        {offers.map((o) => {
          const label = SOURCE_LABELS[o.source] ?? o.source;
          const url = buildSourceUrl({
            source: o.source,
            external_id: o.external_id,
            extracted_data: null,
          });
          const fmtPrice = new Intl.NumberFormat(NUMBER_LOCALE[lang], {
            style: "currency",
            currency: o.currency || "EUR",
            maximumFractionDigits: 0,
          }).format(Number(o.price));
          return (
            <div
              key={o.listing_id}
              className="flex items-center justify-between gap-3 rounded-md bg-[var(--background)] border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {fmtPrice}
                  {o.is_canonical && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                      {t("cluster.shownHere")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] truncate">
                  {label}
                  {o.external_id ? ` · #${o.external_id}` : ""}
                </div>
              </div>
              {url && !o.is_canonical && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                >
                  {t("cluster.view")} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

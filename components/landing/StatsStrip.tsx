import { Sparkles, KeyRound, ShieldCheck, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type Stat = { icon: LucideIcon; value: string; label: string };

async function fetchStats(t: T, lang: SupportedLang): Promise<Stat[] | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;
  const fmt = new Intl.NumberFormat(NUMBER_LOCALE[lang]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // "Verfügbare Immobilien" = unique-Cluster (canonical-Master), nicht
  // alle aktiven Rows. Sonst werden Duplikate (gleiche Wohnung von Bazaraki
  // + INDEX) doppelt gezählt und der Count ist irreführend.
  // canonical_id IS NULL bedeutet: dieses Listing ist selbst der Master
  // (kein parent). Self-Referenzen (canonical_id = id) gibt's nicht.

  const [activeRes, newRes, scamRes, priceRes] = await Promise.all([
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .is("canonical_id", null),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gte("created_at", since24h)
      .is("canonical_id", null),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("scam_checked_at", "is", null)
      .is("canonical_id", null),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("market_position", "is", null)
      .neq("market_position", "unknown")
      .is("canonical_id", null),
  ]);

  const active = activeRes.count ?? 0;
  const new24h = newRes.count ?? 0;
  const scamChecked = scamRes.count ?? 0;
  const priceRated = priceRes.count ?? 0;

  return [
    { icon: Sparkles, value: fmt.format(new24h), label: t("stats.dailyNew") },
    { icon: KeyRound, value: fmt.format(active), label: t("stats.available") },
    { icon: ShieldCheck, value: fmt.format(scamChecked), label: t("stats.verified") },
    { icon: TrendingUp, value: fmt.format(priceRated), label: t("stats.priceRating") },
  ];
}

export async function StatsStrip() {
  const { t, lang } = await getT();
  const stats = await fetchStats(t, lang);
  if (!stats) return null;

  return (
    <section className="bg-[var(--brand-navy)] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-4">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3 sm:justify-center">
            <s.icon className="size-7 sm:size-8 text-[var(--brand-gold)] shrink-0" strokeWidth={1.5} />
            <div className="leading-tight">
              <div className="font-semibold text-base sm:text-lg">{s.value}</div>
              <div className="text-xs sm:text-sm text-white/70">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

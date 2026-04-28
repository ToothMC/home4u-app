import { Sparkles, KeyRound, ShieldCheck, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * StatsStrip — Vier Live-KPIs als Trust-Anker auf der Landingpage.
 * Daten werden zur Build- bzw. Request-Zeit aus Supabase gezogen.
 * Bei fehlendem Service-Client fällt der Component still aus (renders nichts).
 */

const NUMBER_FMT = new Intl.NumberFormat("de-DE");

type Stat = { icon: LucideIcon; value: string; label: string };

async function fetchStats(): Promise<Stat[] | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [activeRes, newRes, scamRes, priceRes] = await Promise.all([
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gte("created_at", since24h),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("scam_checked_at", "is", null),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("market_position", "is", null)
      .neq("market_position", "unknown"),
  ]);

  const active = activeRes.count ?? 0;
  const new24h = newRes.count ?? 0;
  const scamChecked = scamRes.count ?? 0;
  const priceRated = priceRes.count ?? 0;

  return [
    { icon: Sparkles, value: NUMBER_FMT.format(new24h), label: "Täglich neue Inserate" },
    { icon: KeyRound, value: NUMBER_FMT.format(active), label: "Verfügbare Immobilien" },
    { icon: ShieldCheck, value: NUMBER_FMT.format(scamChecked), label: "Geprüfte Inserate" },
    { icon: TrendingUp, value: NUMBER_FMT.format(priceRated), label: "Preisbewertung" },
  ];
}

export async function StatsStrip() {
  const stats = await fetchStats();
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

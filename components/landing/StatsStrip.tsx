import { Users, KeyRound, ShieldCheck, Headphones } from "lucide-react";

const STATS = [
  { icon: Users, value: "10.000+", label: "Zufriedene Nutzer" },
  { icon: KeyRound, value: "4.500+", label: "Verfügbare Immobilien" },
  { icon: ShieldCheck, value: "Geprüfte", label: "Anbieter" },
  { icon: Headphones, value: "Persönlicher", label: "Support" },
];

export function StatsStrip() {
  return (
    <section className="bg-[var(--brand-navy)] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-4">
        {STATS.map((s) => (
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

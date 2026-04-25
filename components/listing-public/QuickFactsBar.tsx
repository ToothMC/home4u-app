import {
  CalendarDays,
  DoorClosed,
  Maximize,
  Wallet,
  Shield,
} from "lucide-react";
import type { PublicListingData } from "./types";

export function QuickFactsBar({ listing }: { listing: PublicListingData }) {
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];

  // Preis: Warm bevorzugt, sonst Standard
  const price = listing.price_warm ?? listing.price;
  facts.push({
    icon: <Wallet className="size-4" />,
    label: listing.price_warm ? "Warmmiete" : listing.type === "rent" ? "Miete" : "Kaufpreis",
    value: formatPrice(price, listing.currency, listing.type),
  });

  if (listing.size_sqm) {
    facts.push({
      icon: <Maximize className="size-4" />,
      label: "Wohnfläche",
      value: `${listing.size_sqm} m²`,
    });
  }
  if (listing.rooms != null) {
    facts.push({
      icon: <DoorClosed className="size-4" />,
      label: "Zimmer",
      value: listing.rooms === 0 ? "Studio" : String(listing.rooms),
    });
  }
  facts.push({
    icon: <CalendarDays className="size-4" />,
    label: "Verfügbarkeit",
    value: listing.available_from
      ? `ab ${new Date(listing.available_from).toLocaleDateString("de-DE")}`
      : "sofort",
  });
  if (listing.deposit) {
    facts.push({
      icon: <Shield className="size-4" />,
      label: "Kaution",
      value: formatPrice(listing.deposit, listing.currency, "rent"),
    });
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">
        Das Wichtigste auf einen Blick
      </h2>
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
    </section>
  );
}

function formatPrice(amount: number, currency: string, type: "rent" | "sale") {
  const fmt = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
  return type === "rent" ? `${fmt} / Mt.` : fmt;
}

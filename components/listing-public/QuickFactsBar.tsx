import {
  CalendarDays,
  DoorClosed,
  Maximize,
  Wallet,
  Shield,
  Building,
  Zap,
} from "lucide-react";
import type { PublicListingData } from "./types";

export function QuickFactsBar({ listing }: { listing: PublicListingData }) {
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];

  facts.push({
    icon: <Wallet className="size-4" />,
    label: listing.type === "rent" ? "Miete / Mt." : "Kaufpreis",
    value: formatPrice(listing.price, listing.currency, listing.type),
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
  if (listing.service_charge_monthly) {
    facts.push({
      icon: <Building className="size-4" />,
      label: "Service-Charge / Mt.",
      value: formatPrice(listing.service_charge_monthly, listing.currency, "rent"),
    });
  }
  if (listing.utilities?.estimated_monthly_total) {
    facts.push({
      icon: <Zap className="size-4" />,
      label: "Nebenkosten / Mt.",
      value: `~${formatPrice(listing.utilities.estimated_monthly_total, listing.currency, "rent")}`,
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

      {listing.utilities && hasUtilityInfo(listing.utilities) && (
        <UtilitiesNote utilities={listing.utilities} />
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

const UTILITY_LABEL: Record<string, string> = {
  tenant_pays: "Mieter zahlt",
  included: "inklusive",
  landlord_pays: "Vermieter zahlt",
  estimated: "geschätzt",
  not_provided: "nicht vorhanden",
};

function UtilitiesNote({
  utilities,
}: {
  utilities: NonNullable<PublicListingData["utilities"]>;
}) {
  const items: { label: string; value: string }[] = [];
  if (utilities.electricity)
    items.push({ label: "Strom", value: UTILITY_LABEL[utilities.electricity] ?? utilities.electricity });
  if (utilities.water)
    items.push({ label: "Wasser", value: UTILITY_LABEL[utilities.water] ?? utilities.water });
  if (utilities.internet)
    items.push({ label: "Internet", value: UTILITY_LABEL[utilities.internet] ?? utilities.internet });
  if (utilities.garbage)
    items.push({ label: "Müll", value: UTILITY_LABEL[utilities.garbage] ?? utilities.garbage });

  return (
    <div id="costs" className="mt-3 rounded-xl border bg-[var(--card)] px-4 py-3 space-y-2 text-sm">
      <div className="font-semibold text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
        Nebenkosten-Aufstellung
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
            ? "Verträge laufen auf den Mieter (eigene Anmeldung erforderlich)."
            : "Verträge laufen über den Vermieter."}
        </div>
      )}
      {utilities.notes && (
        <div className="text-xs italic text-[var(--muted-foreground)]">{utilities.notes}</div>
      )}
    </div>
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

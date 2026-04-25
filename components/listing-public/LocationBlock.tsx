import {
  Bus,
  Trees,
  ShoppingCart,
  Utensils,
  GraduationCap,
  Waves,
  MapPin,
} from "lucide-react";
import type { NearbyPOI } from "./types";

const ICON: Record<NearbyPOI["category"], React.ReactNode> = {
  transit: <Bus className="size-4" />,
  park: <Trees className="size-4" />,
  supermarket: <ShoppingCart className="size-4" />,
  restaurant: <Utensils className="size-4" />,
  school: <GraduationCap className="size-4" />,
  beach: <Waves className="size-4" />,
  other: <MapPin className="size-4" />,
};

export function LocationBlock({
  city,
  district,
  address,
  lat,
  lng,
  pois,
}: {
  city: string;
  district: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  pois: NearbyPOI[];
}) {
  const hasGeo = lat != null && lng != null;
  const mapUrl = hasGeo
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng! - 0.005},${lat! - 0.003},${lng! + 0.005},${lat! + 0.003}&layer=mapnik&marker=${lat},${lng}`
    : null;

  return (
    <section id="nearby" className="rounded-2xl border bg-[var(--card)] p-4 space-y-3">
      <h3 className="text-sm font-semibold">Lage auf einen Blick</h3>

      {hasGeo ? (
        <div className="rounded-xl overflow-hidden border aspect-[2/1]">
          <iframe
            title="Lage"
            src={mapUrl!}
            className="h-full w-full"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-[var(--muted)] aspect-[2/1] flex items-center justify-center text-xs text-[var(--muted-foreground)]">
          Adresse noch nicht hinterlegt
        </div>
      )}

      <div className="text-sm">
        {address ?? `${district ? district + ", " : ""}${city}`}
      </div>

      {pois.length > 0 && (
        <div className="pt-2 border-t">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {pois.slice(0, 6).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-[var(--muted-foreground)]">
                  {ICON[p.category] ?? ICON.other}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    {p.walking_minutes} Min.
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

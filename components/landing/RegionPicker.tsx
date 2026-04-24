"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNTRIES, REGIONS, type Region } from "@/lib/regions";

const LS_KEY = "home4u.region";

export function RegionPicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlRegion = searchParams.get("region");
  const [selected, setSelected] = useState<string | undefined>(
    urlRegion ?? undefined
  );

  // Initial load: URL → LocalStorage fallback
  useEffect(() => {
    if (!urlRegion && typeof window !== "undefined") {
      const stored = window.localStorage.getItem(LS_KEY);
      if (stored) setSelected(stored);
    }
  }, [urlRegion]);

  function pick(region: Region) {
    setSelected(region.slug);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, region.slug);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("region", region.slug);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }

  const byCountry: Record<string, Region[]> = {};
  for (const r of REGIONS) {
    byCountry[r.countrySlug] = byCountry[r.countrySlug] ?? [];
    byCountry[r.countrySlug].push(r);
  }

  return (
    <div className="rounded-xl border p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="size-4 text-[var(--muted-foreground)]" />
        <p className="text-sm font-medium">
          Wo suchst oder vermietest du?
        </p>
      </div>

      {COUNTRIES.map((country) => {
        const regions = byCountry[country.slug] ?? [];
        if (country.status === "planned") {
          return (
            <div
              key={country.slug}
              className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mt-2"
            >
              <span>{country.label}</span>
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] uppercase tracking-wider">
                geplant
              </span>
            </div>
          );
        }
        return (
          <div key={country.slug} className="mb-2">
            <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)] mb-2">
              {country.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => {
                const active = selected === r.slug;
                return (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => pick(r)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-transparent hover:bg-[var(--accent)]"
                    )}
                    aria-pressed={active}
                  >
                    {active && <Check className="size-3" />}
                    <span>{r.city}</span>
                    {r.hint && !active && (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                        · {r.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {selected && (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Auswahl wird auf dich gespeichert und im Chat verwendet.
        </p>
      )}
    </div>
  );
}

export function appendRegionParam(
  href: string,
  region?: string | null
): string {
  if (!region) return href;
  const hasQuery = href.includes("?");
  return `${href}${hasQuery ? "&" : "?"}region=${region}`;
}

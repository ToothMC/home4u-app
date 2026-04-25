"use client";

import * as React from "react";
import {
  Box,
  Euro,
  Map,
  Play,
  Sofa,
  SquareDashed,
} from "lucide-react";
import type { PublicListingData } from "./types";

type Action = {
  key: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  enabled: boolean;
  onClick?: () => void;
  href?: string;
};

export function QuickActionsRow({ listing }: { listing: PublicListingData }) {
  const actions: Action[] = [
    {
      key: "floorplan",
      label: "Grundriss",
      sub: "2D-Grundriss",
      icon: <SquareDashed className="size-5" />,
      enabled: Boolean(listing.floorplan_url),
      href: listing.floorplan_url ?? undefined,
    },
    {
      key: "tour",
      label: "3D-Tour",
      sub: "Interaktiv erleben",
      icon: <Box className="size-5" />,
      enabled: Boolean(listing.tour_3d_url),
      href: listing.tour_3d_url ?? undefined,
    },
    {
      key: "video",
      label: "Video",
      sub: "Wohnung im Video",
      icon: <Play className="size-5" />,
      enabled: Boolean(listing.video_url),
      href: listing.video_url ?? undefined,
    },
    {
      key: "neighborhood",
      label: "Umgebung",
      sub: "Alles in der Nähe",
      icon: <Map className="size-5" />,
      enabled: listing.nearby_pois.length > 0,
      href: "#nearby",
    },
    {
      key: "costs",
      label: "Kosten",
      sub: "Alle Details",
      icon: <Euro className="size-5" />,
      enabled: Boolean(listing.deposit || listing.price_warm),
      href: "#costs",
    },
    {
      key: "furnishing",
      label: "Möblierung",
      sub: "Ausstattungsliste",
      icon: <Sofa className="size-5" />,
      enabled: listing.features.length > 0 || Boolean(listing.furnishing),
      href: "#features",
    },
  ];

  const visible = actions.filter((a) => a.enabled);
  if (visible.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Was man sofort sehen will</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {visible.map((a) => {
          const inner = (
            <div className="rounded-xl border bg-[var(--card)] px-3 py-3 flex items-center gap-3 hover:bg-[var(--accent)] transition-colors">
              <div className="shrink-0 size-9 rounded-md bg-[var(--accent)] flex items-center justify-center">
                {a.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{a.label}</div>
                <div className="text-[10px] text-[var(--muted-foreground)] truncate">
                  {a.sub}
                </div>
              </div>
            </div>
          );
          if (a.href) {
            const isExternal =
              a.href.startsWith("http") || a.href.startsWith("//");
            return isExternal ? (
              <a
                key={a.key}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {inner}
              </a>
            ) : (
              <a key={a.key} href={a.href}>
                {inner}
              </a>
            );
          }
          return <div key={a.key}>{inner}</div>;
        })}
      </div>
    </section>
  );
}

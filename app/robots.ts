import type { MetadataRoute } from "next";
import { LISTING_SITEMAP_BUCKETS } from "@/lib/listings/sitemap-buckets";

const DISALLOW = [
  "/api/",
  "/dashboard/",
  "/d/",
  "/listing-action/",
  "/matches/",
  "/scam-check/result/",
  "/auth/",
  "/admin/",
];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai"
  ).replace(/\/$/, "");

  // Feste Anzahl Teil-Sitemaps (id-Bereiche) — kein COUNT mehr pro Stunde.
  const listingSitemaps = Array.from(
    { length: LISTING_SITEMAP_BUCKETS },
    (_, i) => `${baseUrl}/listings/sitemap/${i}.xml`,
  );

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      // Explicit opt-in for Google's AI training crawler (Gemini)
      { userAgent: "Google-Extended", allow: "/", disallow: DISALLOW },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, ...listingSitemaps],
    host: baseUrl,
  };
}

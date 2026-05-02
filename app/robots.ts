import type { MetadataRoute } from "next";
import { countActiveListings } from "@/lib/repo/public-listing";

export const revalidate = 3600;

const CHUNK_SIZE = 5000;

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

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai"
  ).replace(/\/$/, "");

  const total = await countActiveListings().catch(() => 0);
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  const listingSitemaps = Array.from(
    { length: chunkCount },
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

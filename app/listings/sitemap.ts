import type { MetadataRoute } from "next";
import { listActiveListingIdsInRange } from "@/lib/repo/public-listing";
import {
  LISTING_SITEMAP_BUCKETS,
  listingSitemapRange,
} from "@/lib/listings/sitemap-buckets";
import { siteUrl } from "@/lib/site-url";

export async function generateSitemaps() {
  return Array.from({ length: LISTING_SITEMAP_BUCKETS }, (_, i) => ({ id: i }));
}

export default async function sitemap({
  id,
}: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  // Die Sitemap wird beim Build vorgerendert. Preview-Deployments braucht
  // keine Suchmaschine; dort ~64 Abfragen pro Push zu sparen ist gut die
  // Hälfte der Build-Last auf der Datenbank.
  if (process.env.VERCEL_ENV === "preview") return [];

  const bucket = Number(await id);
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= LISTING_SITEMAP_BUCKETS) {
    return [];
  }

  const baseUrl = siteUrl();

  const { from, to } = listingSitemapRange(bucket);
  const rows = await listActiveListingIdsInRange(from, to);

  return rows.map((r) => ({
    url: `${baseUrl}/listings/${r.id}`,
    lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}

import type { MetadataRoute } from "next";
import {
  countActiveListings,
  listActiveListingIds,
} from "@/lib/repo/public-listing";

const CHUNK_SIZE = 5000;

export async function generateSitemaps() {
  const total = await countActiveListings();
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  return Array.from({ length: chunkCount }, (_, i) => ({ id: i }));
}

export default async function sitemap({
  id,
}: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const idStr = await id;
  const offset = Number(idStr) * CHUNK_SIZE;
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai"
  ).replace(/\/$/, "");

  const rows = await listActiveListingIds(offset, CHUNK_SIZE);

  return rows.map((r) => ({
    url: `${baseUrl}/listings/${r.id}`,
    lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}

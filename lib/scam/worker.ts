/**
 * Async Score-Worker (Indexer-Spec v2.0 §11 Phase A2 — Audit-Empfehlung
 * Option (c)).
 *
 * Crawler upserten Listings ohne Score (sticky-pattern: scam_checked_at = null).
 * Dieser Worker holt batchweise die ungeprüften, berechnet pHashes für ihre
 * Bilder, lädt sie in image_hashes, ruft computeScamScore() und schreibt
 * scam_score / scam_flags / scam_checked_at + extracted_data["scam_explanation"]
 * zurück.
 *
 * Aufruf via:
 *   - POST /api/admin/scam-score-batch (manuell + Cron via GitHub Actions)
 *   - direkt aus Tests/Skripten via runScoreBatch({ limit })
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { dhashFromUrl } from "./phash";
import { computeScamScore } from "./score";

export type ScoreBatchOptions = {
  /** Wie viele Listings pro Lauf maximal scoren. Schutz vor Quota-Spike. */
  limit?: number;
  /** Nur Listings dieser Source. Default: alle. */
  source?: "fb" | "bazaraki" | "direct" | "other";
  /** Wenn true: nur logging, keine DB-Writes. */
  dryRun?: boolean;
};

export type ScoreBatchResult = {
  ok: boolean;
  scanned: number;
  scored: number;
  failed: number;
  skipped: number;
  /** Erste paar Failures für Debugging — nicht alle, sonst Log explodiert. */
  errors: Array<{ listingId: string; error: string }>;
};

const DEFAULT_LIMIT = 25;

export async function runScoreBatch(opts: ScoreBatchOptions = {}): Promise<ScoreBatchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sb = createSupabaseServiceClient();
  if (!sb) {
    return { ok: false, scanned: 0, scored: 0, failed: 0, skipped: 0, errors: [{ listingId: "n/a", error: "supabase service client not configured" }] };
  }

  // Kandidaten: status=active, scam_checked_at is null. Älteste zuerst,
  // damit Bestandslistings rückwirkend gescort werden.
  let q = sb
    .from("listings")
    .select("id, source, type, location_city, location_district, price, contact_phone_hash, media, extracted_data")
    .eq("status", "active")
    .is("scam_checked_at", null)
    .order("first_seen", { ascending: true })
    .limit(limit);
  if (opts.source) q = q.eq("source", opts.source);

  const { data: candidates, error } = await q;
  if (error) {
    return { ok: false, scanned: 0, scored: 0, failed: 0, skipped: 0, errors: [{ listingId: "n/a", error: error.message }] };
  }
  if (!candidates || candidates.length === 0) {
    return { ok: true, scanned: 0, scored: 0, failed: 0, skipped: 0, errors: [] };
  }

  const result: ScoreBatchResult = {
    ok: true,
    scanned: candidates.length,
    scored: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const l of candidates) {
    try {
      // 1) Bilder hashen + persistieren
      const hashes: bigint[] = [];
      const media: string[] = Array.isArray(l.media) ? l.media : [];
      // Begrenze auf erste 6 Bilder pro Listing — Cover ist Index 0, der
      // Rest dient nur Sicherheit. Mehr ist Cost ohne Mehrwert.
      for (const url of media.slice(0, 6)) {
        const h = await dhashFromUrl(url);
        if (h != null) hashes.push(h);
      }

      if (!opts.dryRun && hashes.length > 0) {
        const rows = hashes.map((h, idx) => ({
          phash: h.toString(),
          listing_id: l.id,
          media_url: media[idx],
        }));
        const { error: hashErr } = await sb.from("image_hashes").upsert(rows, {
          onConflict: "phash,listing_id",
          ignoreDuplicates: true,
        });
        if (hashErr) console.warn("[worker] image_hashes upsert failed", l.id, hashErr.message);
      }

      // 2) Score berechnen
      const scoreResult = await computeScamScore({
        listingId: l.id,
        type: l.type as "rent" | "sale",
        city: l.location_city,
        district: l.location_district,
        price: l.price != null ? Number(l.price) : null,
        phoneHash: l.contact_phone_hash,
        imageHashes: hashes,
      });

      // 3) Listing-Update mit Sticky-Trigger (scam_checked_at gesetzt).
      // extracted_data wird gemergt — LLM-Rohextraktion vom Crawler bleibt
      // erhalten, Worker hängt nur seinen scam-Sub-Key dran.
      if (!opts.dryRun) {
        const existing =
          (l.extracted_data && typeof l.extracted_data === "object" && !Array.isArray(l.extracted_data)
            ? (l.extracted_data as Record<string, unknown>)
            : {}) ?? {};
        const merged = {
          ...existing,
          scam: {
            explanation_md: scoreResult.explanation,
            similar_listing_ids: scoreResult.similarListingIds,
            computed_at: new Date().toISOString(),
            worker_version: 1,
          },
        };
        const { error: updErr } = await sb
          .from("listings")
          .update({
            scam_score: scoreResult.score,
            scam_flags: scoreResult.flags,
            scam_checked_at: new Date().toISOString(),
            extracted_data: merged,
          })
          .eq("id", l.id);
        if (updErr) {
          result.failed++;
          if (result.errors.length < 5) {
            result.errors.push({ listingId: l.id, error: updErr.message });
          }
          continue;
        }
      }

      result.scored++;
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      if (result.errors.length < 5) {
        result.errors.push({ listingId: l.id, error: msg });
      }
    }
  }

  // Triggert MV-Refresh asynchron (kein await — Score-Genauigkeit für nächste
  // Runs profitiert, aber aktuelle Antwort wartet nicht).
  if (!opts.dryRun && result.scored > 0) {
    sb.rpc("refresh_district_price_stats").then(({ error: rErr }) => {
      if (rErr) console.warn("[worker] MV refresh failed", rErr.message);
    });
  }

  return result;
}

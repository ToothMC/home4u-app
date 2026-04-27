/**
 * Scam-Score-Engine (Indexer-Spec v2.0 §6).
 *
 * Pure Library, kein HTTP-Endpoint. Aufrufbar aus:
 *   - Score-Worker (lib/scam/worker.ts) — batched ungeprüfte Listings
 *   - Scam-Shield-Produkt (Spec B) — User-Submits gegen scam_checks
 *
 * Score-Output: { score 0..1, flags[], explanation }
 *   - score:       Σ Δ aus Heuristiken, gecapped auf 1.0
 *   - flags:       Stable-IDs der ausgelösten Signale (für UI-Filter, Stats)
 *   - explanation: Markdown-Fließtext mit Beweis pro Flag (Spec §6.4
 *                  Ehrlichkeits-Klausel: "nie nur Scam ja/nein")
 *
 * Sticky-Pattern: Caller (Worker / Spec B) setzt scam_checked_at, sonst
 * überschreibt der nächste bulk_upsert die Score-Felder nicht (Migration 0028).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { DHASH_DUPLICATE_THRESHOLD, hamming } from "./phash";

// =============================================================================
// Schwellen + Δ-Beiträge — alle hier zentralisiert für späteres A/B-Tuning
// (siehe Spec §7.2 match_score_experiments).
// =============================================================================

export const SCAM_THRESHOLDS = {
  // Spec §6.2 Preis-Anomalie
  priceAnomalyFactor: 0.7,        // < 0.7 × median → flag
  priceAnomalyDelta: 0.30,
  // Preis-Hoax
  rentMinPlausible: 100,           // EUR/Monat
  saleMinPlausible: 10_000,        // EUR
  priceImplausibleDelta: 0.40,
  // Phone
  noPhoneDelta: 0.10,
  knownScamPhoneDelta: 0.40,
  // Bilder
  duplicateImagesDelta: 0.40,
  duplicateHammingThreshold: DHASH_DUPLICATE_THRESHOLD,
  // Quarantäne-Schwellen (für UI in Spec B)
  warnFrom: 0.50,                  // 0.5 ≤ score < 0.7 → "verdächtig"
  scamFrom: 0.70,                  // ≥ 0.7 → "deutlich Warnung"
  // Mindest-Bucket-Größe für Preis-Anomalie. Unterhalb davon ist die
  // Preis-Heuristik unzuverlässig (Henne-Ei §0.2). Wird als "low_evidence"
  // geflaggt, aber score nicht erhöht.
  minBucketSizeForPriceAnomaly: 5,
} as const;

// =============================================================================
// Eingangs-/Ausgangs-Typen
// =============================================================================

export type ScamSignals = {
  /** Aktuell geprüftes Listing (oder None bei reinem User-Submit ohne Match). */
  listingId?: string;
  type: "rent" | "sale";
  city?: string | null;
  district?: string | null;
  price?: number | null;
  /** sha256(E.164) — wird gegen scam_phones und cross-listings geprüft. */
  phoneHash?: string | null;
  /** dHashes der Bilder dieses Listings/Submits (signed 64-bit bigint). */
  imageHashes?: bigint[];
  /** Optional: vorberechneter Text-LLM-Score (0..0.30). Wenn fehlt → kein
   *  Text-Heuristik-Beitrag. Eigentlich Job einer Spec-B-Vision-Pipeline. */
  textScamScore?: number;
};

export type ScamFlag =
  | "price_anomaly_low"
  | "price_implausible"
  | "no_phone"
  | "known_scam_phone"
  | "duplicate_images"
  | "text_scam_markers"
  | "low_evidence";

export type ScamResult = {
  score: number;
  flags: ScamFlag[];
  explanation: string;
  /** Listings, die als Beweis für duplicate_images dienen — UI in Spec B
   *  zeigt sie als "Dasselbe Bild auch auf …". */
  similarListingIds: string[];
};

// =============================================================================
// Haupt-Entry-Point
// =============================================================================

/**
 * Berechnet Score + Flags. Liest aus Supabase:
 *   - district_price_stats (Median pro city/district/type)
 *   - scam_phones (bekannte Scam-Nummern)
 *   - image_hashes (für Cross-Listing-Match)
 *
 * Wirft nicht — bei DB-Fehlern liefert sie ein Best-Effort-Resultat mit
 * "low_evidence"-Flag, damit der Worker weiterläuft und kein Listing für
 * immer ungescort bleibt.
 */
export async function computeScamScore(signals: ScamSignals): Promise<ScamResult> {
  const flags: ScamFlag[] = [];
  const evidence: string[] = [];
  const similarListingIds: string[] = [];
  let score = 0;

  const sb = createSupabaseServiceClient();
  if (!sb) {
    return {
      score: 0,
      flags: ["low_evidence"],
      explanation: "Score-Engine: Supabase-Service-Client nicht konfiguriert — kein Score berechnet.",
      similarListingIds: [],
    };
  }

  // --------- Preis-Heuristik (Anomalie + Hoax) ---------
  if (signals.price != null) {
    // Hoax: implausibel niedriger Absolutpreis
    const minPlausible =
      signals.type === "rent" ? SCAM_THRESHOLDS.rentMinPlausible : SCAM_THRESHOLDS.saleMinPlausible;
    if (signals.price < minPlausible) {
      score += SCAM_THRESHOLDS.priceImplausibleDelta;
      flags.push("price_implausible");
      evidence.push(
        `Preis ${signals.price} EUR ist unplausibel niedrig für ${signals.type === "rent" ? "Miete" : "Kauf"} (Schwelle: ${minPlausible} EUR).`
      );
    }

    // Anomalie: < 0.7 × Median für (city, district, type)
    if (signals.city) {
      const districtKey = signals.district ?? "__unknown__";
      const { data, error } = await sb
        .from("district_price_stats")
        .select("median, n")
        .eq("location_city", signals.city)
        .eq("location_district", districtKey)
        .eq("type", signals.type)
        .maybeSingle();
      if (error) {
        console.warn("[scam] district_price_stats query failed", error);
      } else if (data && data.median != null) {
        const n = Number(data.n ?? 0);
        const median = Number(data.median);
        if (n < SCAM_THRESHOLDS.minBucketSizeForPriceAnomaly) {
          // Henne-Ei: zu wenig Vergleichsdaten → kein Score, aber UI weiß warum
          if (!flags.includes("low_evidence")) flags.push("low_evidence");
          evidence.push(
            `Preisvergleich ausgesetzt: nur ${n} Vergleichsinserate für ${signals.city}/${districtKey}/${signals.type}. Score steigt mit Index-Volumen.`
          );
        } else if (signals.price < median * SCAM_THRESHOLDS.priceAnomalyFactor) {
          score += SCAM_THRESHOLDS.priceAnomalyDelta;
          flags.push("price_anomaly_low");
          const pct = Math.round((1 - signals.price / median) * 100);
          evidence.push(
            `Preis ${signals.price} EUR liegt ${pct} % unter Median ${median} EUR für ${signals.city}/${districtKey} (Mittel aus ${n} Inseraten).`
          );
        }
      }
    }
  }

  // --------- Phone-Heuristik ---------
  if (!signals.phoneHash) {
    score += SCAM_THRESHOLDS.noPhoneDelta;
    flags.push("no_phone");
    evidence.push("Keine Telefonnummer im Inserat — Anbieter nicht direkt kontaktierbar.");
  } else {
    const { data, error } = await sb
      .from("scam_phones")
      .select("source, reason, reported_at")
      .eq("phone_hash", signals.phoneHash)
      .maybeSingle();
    if (error) {
      console.warn("[scam] scam_phones query failed", error);
    } else if (data) {
      score += SCAM_THRESHOLDS.knownScamPhoneDelta;
      flags.push("known_scam_phone");
      evidence.push(
        `Telefonnummer ist als Scam markiert (Quelle: ${data.source}${data.reason ? `, Grund: ${data.reason}` : ""}).`
      );
    }
  }

  // --------- Bilder-Cross-Match ---------
  if (signals.imageHashes && signals.imageHashes.length > 0) {
    const matches = await findDuplicateImageListings(
      sb,
      signals.imageHashes,
      signals.listingId,
      signals.phoneHash,
      signals.price,
      signals.district,
    );
    if (matches.size > 0) {
      score += SCAM_THRESHOLDS.duplicateImagesDelta;
      flags.push("duplicate_images");
      similarListingIds.push(...matches);
      evidence.push(
        `Mindestens ein Bild wird in ${matches.size} ${matches.size === 1 ? "anderem Inserat" : "anderen Inseraten"} mit unterschiedlichen Daten verwendet (anderer Anbieter, Preis oder District).`
      );
    }
  }

  // --------- Text-Heuristik (Vor-Score von Spec-B-Vision) ---------
  if (signals.textScamScore != null && signals.textScamScore > 0) {
    const delta = Math.min(0.30, Math.max(0, signals.textScamScore));
    score += delta;
    flags.push("text_scam_markers");
    evidence.push(`Text-Analyse hat Scam-Marker gefunden (+${delta.toFixed(2)}).`);
  }

  // --------- Score capping + Explanation rendern ---------
  score = Math.min(1.0, Math.max(0, score));
  const explanation = renderExplanation(score, flags, evidence);

  return { score, flags, explanation, similarListingIds };
}

// =============================================================================
// Cross-Listing-Image-Match
// =============================================================================

type Sb = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

async function findDuplicateImageListings(
  sb: Sb,
  hashes: bigint[],
  myListingId: string | undefined,
  myPhoneHash: string | null | undefined,
  myPrice: number | null | undefined,
  myDistrict: string | null | undefined,
): Promise<Set<string>> {
  // Wir holen alle Hashes mit Hamming ≤ DHASH_DUPLICATE_THRESHOLD.
  // Postgres-RPC phash_hamming() wäre eleganter, aber wir brauchen die
  // Liste der Listings — für 559 Inserate scannen wir lokal.
  // TODO: bei >50k Hashes einen bk-tree-Index einführen.
  //
  // Wichtig: nur Listing-Hashes als Cross-Match-Quelle. User-Submissions
  // (scam_check_id IS NOT NULL) würden sich sonst gegenseitig flaggen
  // (Migration 0034). Cross-Match geht IMMER gegen den Index.
  const { data, error } = await sb
    .from("image_hashes")
    .select("phash, listing_id")
    .not("listing_id", "is", null);
  if (error || !data) {
    console.warn("[scam] image_hashes query failed", error);
    return new Set();
  }

  const matchingListings = new Set<string>();
  for (const row of data) {
    if (myListingId && row.listing_id === myListingId) continue;
    const rowHash = BigInt(row.phash); // Supabase liefert bigint als string
    for (const h of hashes) {
      if (hamming(rowHash, h) <= SCAM_THRESHOLDS.duplicateHammingThreshold) {
        matchingListings.add(row.listing_id);
        break;
      }
    }
  }
  if (matchingListings.size === 0) return matchingListings;

  // Filter: nur Listings mit unterschiedlichen Daten zählen als Cross-Match.
  // Sonst flag'd ein Re-Crawl desselben Inserats (gleiche Bilder, gleiche
  // Daten) sich selbst als Scam.
  const ids = Array.from(matchingListings);
  const { data: peers } = await sb
    .from("listings")
    .select("id, contact_phone_hash, price, location_district")
    .in("id", ids);
  if (!peers) return new Set();

  const filtered = new Set<string>();
  for (const p of peers) {
    const phoneDiffers = !!myPhoneHash && !!p.contact_phone_hash && p.contact_phone_hash !== myPhoneHash;
    const priceDiffers =
      myPrice != null && p.price != null && Math.abs(Number(p.price) - myPrice) > 50;
    const districtDiffers =
      !!myDistrict && !!p.location_district && p.location_district !== myDistrict;
    if (phoneDiffers || priceDiffers || districtDiffers) {
      filtered.add(p.id);
    }
  }
  return filtered;
}

// =============================================================================
// Markdown-Explanation
// =============================================================================

function renderExplanation(score: number, flags: ScamFlag[], evidence: string[]): string {
  const verdict =
    score >= SCAM_THRESHOLDS.scamFrom
      ? "**Deutliche Warnung**"
      : score >= SCAM_THRESHOLDS.warnFrom
      ? "**Verdächtig**"
      : "Keine deutlichen Scam-Signale";

  const lines: string[] = [
    `${verdict} (Score: ${score.toFixed(2)})`,
    "",
  ];
  if (evidence.length > 0) {
    lines.push("**Gefundene Signale:**");
    for (const e of evidence) lines.push(`- ${e}`);
  } else {
    lines.push("Keine Heuristik hat angeschlagen. Alle geprüften Felder unauffällig.");
  }
  if (flags.includes("low_evidence")) {
    lines.push("");
    lines.push(
      "_Hinweis: Score-Qualität wächst mit Index-Volumen (Spec §0.2). Aktuell sind manche Vergleichs-Buckets dünn besetzt._"
    );
  }
  return lines.join("\n");
}

// Scam-Shield POST-Endpoint (Spec B §3).
//
// Phase B1: nur input_kind='text' implementiert. URL und Image kommen in
// B2/B3. Text-Path: Haiku-Strukturextraktion → Score-Engine → scam_checks.
//
// Auth-Modi (Spec §3.2):
//   - eingeloggt:  user_id wird gesetzt
//   - anonymous:   Cookie home4u_sid → anonymous_id
//
// Quota (Spec §3.3): 3 Checks/Monat Free, Premium unlimited.

import { createHash } from "node:crypto";

import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computeScamScore, SCAM_THRESHOLDS, type ScamFlag } from "@/lib/scam/score";
import { extractTextListing } from "@/lib/scam/extract-text";
import { extractImageListing } from "@/lib/scam/extract-image";
import { dhashBuffer } from "@/lib/scam/phash";
import { checkScamQuota } from "@/lib/scam/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vision (B3) braucht das, Text (B1) selten — aber großzügig setzen.
export const maxDuration = 60;

type Verdict = "clean" | "warn" | "high";

function verdictFor(score: number): Verdict {
  if (score >= SCAM_THRESHOLDS.scamFrom) return "high";
  if (score >= SCAM_THRESHOLDS.warnFrom) return "warn";
  return "clean";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeE164(raw: string): string | null {
  const trimmed = raw.replace(/[^\d+]/g, "");
  if (!trimmed) return null;
  // Sehr leichter Sanity-Check; LLM gibt schon E.164 zurück (lib/scam/extract-text.ts)
  if (!/^\+\d{8,15}$/.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// URL-Source-Whitelist + ID-Extraktion (Spec §6.1 / §6.2)
// ---------------------------------------------------------------------------

const URL_SOURCES: Array<{
  source: "bazaraki" | "fb";
  pattern: RegExp;
  /** Liefert source-eigene ID aus URL-Match. */
  extractId(match: RegExpExecArray): string;
}> = [
  {
    source: "bazaraki",
    pattern: /bazaraki\.com\/adv\/(\d+)/i,
    extractId: (m) => m[1],
  },
  {
    source: "fb",
    // /groups/<gid>/posts/<pid>/ oder /groups/<gid>/permalink/<pid>/
    pattern: /facebook\.com\/groups\/[^/]+\/(?:posts|permalink)\/(\d+)/i,
    extractId: (m) => m[1],
  },
];

function classifyUrl(url: string): { source: "bazaraki" | "fb"; externalId: string } | null {
  for (const { source, pattern, extractId } of URL_SOURCES) {
    const m = pattern.exec(url);
    if (m) return { source, externalId: extractId(m) };
  }
  return null;
}

async function handleUrlIndexLookup(
  url: string,
  identity: { userId: string; anonymousId?: null } | { userId?: null; anonymousId: string },
) {
  const classified = classifyUrl(url);
  if (!classified) {
    return Response.json(
      { error: "url_not_whitelisted", reason: "Aktuell nur Bazaraki + Facebook-Permalinks." },
      { status: 422 },
    );
  }

  const sb = createSupabaseServiceClient();
  if (!sb) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Quota-Check für URL-Path identisch
  const quota = await checkScamQuota(identity);
  if (!quota.allowed) {
    return Response.json(
      {
        error: "quota_exhausted",
        tier: quota.tier,
        used: quota.used,
        limit: quota.limit,
        reset_at: quota.resetAt,
      },
      { status: 429 },
    );
  }

  // Index-Cache-Hit: Listing nach (source, external_id) suchen.
  const { data: listing, error } = await sb
    .from("listings")
    .select(
      "id, source, external_id, type, location_city, location_district, price, rooms, scam_score, scam_flags, contact_phone_hash",
    )
    .eq("source", classified.source)
    .eq("external_id", classified.externalId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[scam-check] url lookup failed", error);
    return Response.json({ error: "lookup_failed" }, { status: 500 });
  }

  if (!listing) {
    return Response.json(
      {
        error: "url_not_in_index",
        reason: "Inserat noch nicht im Home4U-Index. Lade einen Screenshot hoch oder paste den Text rein.",
      },
      { status: 422 },
    );
  }

  // Score liegt schon vor → Result-Shape direkt rendern.
  const flags = (listing.scam_flags as string[] | null) ?? [];
  const score = Number(listing.scam_score ?? 0);
  const explanation = renderUrlExplanation(listing, flags, score);

  // In scam_checks für Quota + History persistieren.
  let checkId: string | null = null;
  const { data: inserted } = await sb
    .from("scam_checks")
    .insert({
      user_id: identity.userId ?? null,
      anonymous_id: identity.anonymousId ?? null,
      input_kind: "url",
      input_url: url.slice(0, 500),
      score,
      flags,
      similar_listing_ids: [listing.id],
      explanation_md: explanation,
      contact_phone_hash: (listing as { contact_phone_hash?: string | null }).contact_phone_hash ?? null,
    })
    .select("id")
    .single();
  if (inserted) checkId = inserted.id as string;

  return Response.json({
    id: checkId,
    score,
    verdict: verdictFor(score),
    flags,
    explanation_md: explanation,
    similar_listing_ids: [listing.id],
    extracted: {
      listing_type: listing.type,
      price: listing.price != null ? Number(listing.price) : null,
      city: listing.location_city,
      district: listing.location_district,
      rooms: listing.rooms,
    },
    remaining_quota: Number.isFinite(quota.remaining) ? quota.remaining - 1 : null,
    tier: quota.tier,
    source: "index_cache_hit",
  });
}

// ---------------------------------------------------------------------------
// Image-Upload (Spec §2.2 / §5)
// ---------------------------------------------------------------------------

const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const IMAGE_ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function handleImageUpload(
  req: Request,
  identity: { userId: string; anonymousId?: null } | { userId?: null; anonymousId: string },
) {
  // Quota erst — sonst hochladen wir erst, blocken dann
  const quota = await checkScamQuota(identity);
  if (!quota.allowed) {
    return Response.json(
      {
        error: "quota_exhausted",
        tier: quota.tier,
        used: quota.used,
        limit: quota.limit,
        reset_at: quota.resetAt,
      },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_file", reason: "Feld 'file' nicht im Form-Body." }, { status: 400 });
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return Response.json({ error: "file_too_large", limit_bytes: IMAGE_MAX_BYTES }, { status: 413 });
  }
  if (!IMAGE_ALLOWED_MIMES.has(file.type)) {
    return Response.json(
      { error: "unsupported_mime", reason: `Erlaubt: ${[...IMAGE_ALLOWED_MIMES].join(", ")}` },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // 1) Vision-Extraktion
  let extracted;
  try {
    extracted = await extractImageListing(buf, file.type);
  } catch (err) {
    console.error("[scam-check] image extract failed", err);
    return Response.json({ error: "extract_failed" }, { status: 502 });
  }

  if (extracted.confidence < 0.3 && extracted.listing_type === "unknown") {
    return Response.json(
      { error: "input_unparseable", reason: "Konnte kein Inserat im Bild erkennen." },
      { status: 422 },
    );
  }

  // 2) dHash für Cross-Match (Spec §6.2 duplicate_images)
  let imageHash: bigint | null = null;
  try {
    imageHash = await dhashBuffer(buf);
  } catch (err) {
    console.warn("[scam-check] dhashBuffer failed", err);
    // weiter ohne Cross-Match — Score-Engine setzt dann nur die anderen Heuristiken
  }

  // 3) Phone-Hash
  let phoneHash: string | null = null;
  if (extracted.contact_phone) {
    const e164 = normalizeE164(extracted.contact_phone);
    if (e164) phoneHash = sha256Hex(e164);
  }

  // 4) Score-Engine
  const scoreResult = await computeScamScore({
    type: extracted.listing_type === "unknown" ? "rent" : extracted.listing_type,
    city: extracted.city ?? null,
    district: extracted.district ?? null,
    price: extracted.price ?? null,
    phoneHash,
    imageHashes: imageHash != null ? [imageHash] : undefined,
    textScamScore: extracted.text_scam_score,
  });

  // 5) Persistieren
  const sb = createSupabaseServiceClient();
  let checkId: string | null = null;
  if (sb) {
    const { data: inserted, error } = await sb
      .from("scam_checks")
      .insert({
        user_id: identity.userId ?? null,
        anonymous_id: identity.anonymousId ?? null,
        input_kind: "image" as const,
        input_url: null,
        score: scoreResult.score,
        flags: scoreResult.flags,
        similar_listing_ids: scoreResult.similarListingIds,
        explanation_md: scoreResult.explanation,
        contact_phone_hash: phoneHash,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[scam-check] insert failed", error);
    } else {
      checkId = inserted.id as string;
    }
    // pHash für künftige Cross-Matches persistieren (Migration 0034).
    // Bilddaten selbst werden NICHT gespeichert — nur der Hash + ein
    // anonymer media_url-Marker.
    if (checkId && imageHash != null) {
      await sb
        .from("image_hashes")
        .insert({
          phash: imageHash.toString(),
          scam_check_id: checkId,
          media_url: `scam_check:${checkId}`,
        });
    }
  }

  return Response.json({
    id: checkId,
    score: scoreResult.score,
    verdict: verdictFor(scoreResult.score),
    flags: scoreResult.flags as ScamFlag[],
    explanation_md: scoreResult.explanation,
    similar_listing_ids: scoreResult.similarListingIds,
    extracted: {
      listing_type: extracted.listing_type,
      price: extracted.price ?? null,
      currency: extracted.currency ?? null,
      city: extracted.city ?? null,
      district: extracted.district ?? null,
      rooms: extracted.rooms ?? null,
      size_sqm: extracted.size_sqm ?? null,
      language: extracted.language ?? null,
      confidence: extracted.confidence,
      quality_signals: extracted.quality_signals,
    },
    remaining_quota: Number.isFinite(quota.remaining) ? quota.remaining - 1 : null,
    tier: quota.tier,
    source: "image",
  });
}

function renderUrlExplanation(
  l: { source: string; type: string; price: number | string | null; location_city: string; location_district: string | null },
  flags: string[],
  score: number,
): string {
  const verdict = score >= 0.7 ? "**Deutliche Warnung**" : score >= 0.5 ? "**Verdächtig**" : "Keine deutlichen Scam-Signale";
  const lines = [
    `${verdict} (Score: ${score.toFixed(2)}) — ${l.source}-Inserat im Index gefunden.`,
    "",
    `${l.type === "rent" ? "Miete" : "Kauf"} in ${l.location_city}${l.location_district ? "/" + l.location_district : ""} · ${l.price ?? "?"} EUR`,
    "",
  ];
  if (flags.length === 0) {
    lines.push("Alle geprüften Felder unauffällig.");
  } else {
    lines.push("**Gefundene Signale:** " + flags.join(", "));
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  // --- 1) Identity auflösen ----------------------------------------------
  // Auth-only seit 2026-04-30: anonymous-Pfad geschlossen damit die Quota
  // sauber pro Person zählt und kein Bot-Spam entsteht.
  const authUser = await getAuthUser();
  if (!authUser) {
    return Response.json(
      {
        ok: false,
        error: "auth_required",
        message:
          "Für die Verwendung des Scam-Checkers bitte erst einloggen.",
      },
      { status: 401 }
    );
  }
  const identity: { userId: string; anonymousId?: null } = {
    userId: authUser.id,
  };

  // --- 2) Body lesen + Kind-Switch ---------------------------------------
  // multipart/form-data → image-path; sonst json
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    return handleImageUpload(req, identity);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const kind = (body as { kind?: string })?.kind;
  if (kind !== "text" && kind !== "url" && kind !== "image") {
    return Response.json({ error: "invalid_kind", expected: ["text", "url", "image"] }, { status: 400 });
  }
  if (kind === "image") {
    return Response.json(
      { error: "expected_multipart", reason: "Bilder bitte als multipart/form-data hochladen." },
      { status: 415 },
    );
  }

  // --- URL-Path: Index-Cache-Hit (Spec §6.2 Pfad c) -----------------------
  if (kind === "url") {
    const url = (body as { url?: string })?.url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return Response.json({ error: "input_too_short", reason: "Gültige URL nötig." }, { status: 422 });
    }
    return handleUrlIndexLookup(url, identity);
  }

  const text = (body as { text?: string })?.text;
  if (typeof text !== "string" || text.trim().length < 30) {
    return Response.json(
      { error: "input_too_short", reason: "Text mindestens 30 Zeichen." },
      { status: 422 },
    );
  }

  // --- 3) Quota prüfen ----------------------------------------------------
  const quota = await checkScamQuota(identity);
  if (!quota.allowed) {
    return Response.json(
      {
        error: "quota_exhausted",
        tier: quota.tier,
        used: quota.used,
        limit: quota.limit,
        reset_at: quota.resetAt,
      },
      { status: 429 },
    );
  }

  // --- 4) Strukturextraktion via Haiku -----------------------------------
  let extracted;
  try {
    extracted = await extractTextListing(text);
  } catch (err) {
    console.error("[scam-check] extract failed", err);
    return Response.json({ error: "extract_failed" }, { status: 502 });
  }

  // Wenn LLM nichts halbwegs Brauchbares zurückgibt, nicht weiter scoren —
  // sonst würde "no_phone" + "low_evidence" einen falsch-positiven Score
  // auf irgendwelchen Schrott legen.
  if (extracted.confidence < 0.3 && extracted.listing_type === "unknown") {
    return Response.json(
      { error: "input_unparseable", reason: "Konnte kein Inserat erkennen." },
      { status: 422 },
    );
  }

  // --- 5) Phone-Hash (für scam_phones-Lookup) -----------------------------
  let phoneHash: string | null = null;
  if (extracted.contact_phone) {
    const e164 = normalizeE164(extracted.contact_phone);
    if (e164) phoneHash = sha256Hex(e164);
  }

  // --- 6) Score-Engine ----------------------------------------------------
  // Text + Language fließen nur als bereits-gewichteter textScamScore
  // (Engine-Eingang aus extract-text.ts) ein — die Engine selbst hat keinen
  // separaten Text-/Sprache-Slot. Image-Hashes erst in B3.
  const scoreResult = await computeScamScore({
    type: extracted.listing_type === "unknown" ? "rent" : extracted.listing_type,
    city: extracted.city ?? null,
    district: extracted.district ?? null,
    price: extracted.price ?? null,
    phoneHash,
    textScamScore: extracted.text_scam_score,
  });

  // --- 7) Persistieren in scam_checks ------------------------------------
  const sb = createSupabaseServiceClient();
  let checkId: string | null = null;
  if (sb) {
    const insertPayload = {
      user_id: identity.userId ?? null,
      anonymous_id: identity.anonymousId ?? null,
      input_kind: "text" as const,
      input_url: null,
      score: scoreResult.score,
      flags: scoreResult.flags,
      similar_listing_ids: scoreResult.similarListingIds,
      explanation_md: scoreResult.explanation,
    };
    const { data, error } = await sb
      .from("scam_checks")
      .insert(insertPayload)
      .select("id")
      .single();
    if (error) {
      console.error("[scam-check] insert failed", error);
    } else {
      checkId = data.id as string;
    }
  }

  // --- 8) Response (Spec §3.1 shape) -------------------------------------
  return Response.json({
    id: checkId,
    score: scoreResult.score,
    verdict: verdictFor(scoreResult.score),
    flags: scoreResult.flags as ScamFlag[],
    explanation_md: scoreResult.explanation,
    similar_listing_ids: scoreResult.similarListingIds,
    extracted: {
      listing_type: extracted.listing_type,
      price: extracted.price ?? null,
      currency: extracted.currency ?? null,
      city: extracted.city ?? null,
      district: extracted.district ?? null,
      rooms: extracted.rooms ?? null,
      size_sqm: extracted.size_sqm ?? null,
      language: extracted.language ?? null,
      confidence: extracted.confidence,
      quality_signals: extracted.quality_signals,
    },
    remaining_quota: Number.isFinite(quota.remaining) ? quota.remaining - 1 : null,
    tier: quota.tier,
  });
}

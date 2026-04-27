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
import { getOrCreateAnonymousSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computeScamScore, SCAM_THRESHOLDS, type ScamFlag } from "@/lib/scam/score";
import { extractTextListing } from "@/lib/scam/extract-text";
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

export async function POST(req: Request) {
  // --- 1) Identity auflösen ----------------------------------------------
  const authUser = await getAuthUser();
  let identity: { userId: string; anonymousId?: null } | { userId?: null; anonymousId: string };
  if (authUser) {
    identity = { userId: authUser.id };
  } else {
    const sess = await getOrCreateAnonymousSession();
    identity = { anonymousId: sess.anonymousId };
  }

  // --- 2) Body lesen + Kind-Switch ---------------------------------------
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
  if (kind === "url") {
    return Response.json({ error: "not_implemented", phase: "B2" }, { status: 501 });
  }
  if (kind === "image") {
    return Response.json({ error: "not_implemented", phase: "B3" }, { status: 501 });
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

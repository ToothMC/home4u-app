/**
 * HMAC-signed Token für Outreach-Action-Links.
 *
 * Use-Case: in einer Mail an den Inserenten haben wir 3 Buttons:
 *   - „Inserat ist vermietet" → mark-rented
 *   - „Antworten / Anfrage öffnen" → reply
 *   - „Gehört nicht zu mir" → wrong-listing
 *
 * Jeder Button enthält einen JWT mit allen Daten, die der Action-Endpoint
 * braucht. Der JWT IST die Autorisierung — kein Login-Modal.
 *
 * Single-use: der Action-Endpoint trackt verwendete Tokens via outreach_log
 * (clicked_at) und/oder ein separates token_jti. Replay innerhalb 30 Tage
 * möglich, aber idempotent (selbe Aktion).
 *
 * Sec: Pepper aus IMPORT_PREVIEW_SECRET (≥32 chars) oder SUPABASE_SERVICE_ROLE_KEY.
 * Identische Secret-Wahl wie lib/import/preview-token.ts.
 */
import { SignJWT, jwtVerify } from "jose";

const TOKEN_TTL_DAYS = 30;
const ISSUER = "home4u-outreach";

export type ActionKind = "mark_rented" | "reply" | "wrong_listing" | "still_available";

export type ActionTokenPayload = {
  match_id: string;
  listing_id: string;
  recipient_email_hash: string;
  action: ActionKind;
  log_id: string;
};

function getSecret(): Uint8Array {
  const raw =
    process.env.IMPORT_PREVIEW_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (raw.length < 32) {
    throw new Error(
      "Secret für Action-Token fehlt (IMPORT_PREVIEW_SECRET ≥32 Zeichen, oder SUPABASE_SERVICE_ROLE_KEY als Fallback)"
    );
  }
  return new TextEncoder().encode(raw);
}

export async function signActionToken(payload: ActionTokenPayload): Promise<string> {
  return await new SignJWT({
    match_id: payload.match_id,
    listing_id: payload.listing_id,
    recipient_email_hash: payload.recipient_email_hash,
    action: payload.action,
    log_id: payload.log_id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_DAYS}d`)
    .sign(getSecret());
}

export async function verifyActionToken(token: string): Promise<ActionTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER });
  if (
    typeof payload.match_id !== "string" ||
    typeof payload.listing_id !== "string" ||
    typeof payload.recipient_email_hash !== "string" ||
    typeof payload.log_id !== "string" ||
    typeof payload.action !== "string"
  ) {
    throw new Error("invalid_token_payload");
  }
  const action = payload.action as ActionKind;
  if (!["mark_rented", "reply", "wrong_listing", "still_available"].includes(action)) {
    throw new Error("invalid_action");
  }
  return {
    match_id: payload.match_id,
    listing_id: payload.listing_id,
    recipient_email_hash: payload.recipient_email_hash,
    action,
    log_id: payload.log_id,
  };
}

/**
 * Sha256-Hash einer Email-Adresse für outreach_log.recipient_hash.
 * Lowercased + trimmed vor Hashing für Stabilität gegen Whitespace-Varianten.
 */
export async function hashEmail(email: string): Promise<string> {
  const norm = email.trim().toLowerCase();
  const data = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sha256-Hash einer Telefonnummer (normalisiert auf Ziffern, mit Country-Code).
 * Identisch zu bazaraki-crawler/src/dedup.py:compute_phone_hash damit
 * Cross-Source-Dedup-Hash und Outreach-Hash zusammenfallen.
 */
export async function hashPhone(phoneE164Digits: string): Promise<string> {
  const norm = phoneE164Digits.replace(/\D/g, "");
  if (norm.length < 8) throw new Error("phone_too_short");
  const data = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

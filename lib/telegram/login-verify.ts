/**
 * Telegram-Login-Widget-Verifikation.
 *
 * Spezifikation: https://core.telegram.org/widgets/login#checking-authorization
 *
 * Das Widget POSTet beim Klick auf "Mit Telegram anmelden" diese Felder:
 *   id, first_name, last_name?, username?, photo_url?, auth_date, hash
 *
 * Verifikation:
 *   1. Alle Felder außer `hash` sortiert in `key=value\n...`-Format
 *   2. secret_key = SHA-256(bot_token)
 *   3. computed = HMAC-SHA256(secret_key, data_check_string)
 *   4. computed === hash → valid
 *   5. auth_date max 1 Tag alt
 */
import { createHash, createHmac } from "node:crypto";

export type TelegramLoginPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export type VerifyResult =
  | { ok: true; payload: TelegramLoginPayload }
  | { ok: false; error: "invalid_hash" | "expired" | "missing_token" | "malformed" };

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramLogin(
  raw: Record<string, unknown>
): VerifyResult {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "missing_token" };

  // Felder extrahieren + validieren
  const idNum = Number(raw.id);
  const authDateNum = Number(raw.auth_date);
  const hash = typeof raw.hash === "string" ? raw.hash : "";
  const firstName = typeof raw.first_name === "string" ? raw.first_name : "";
  if (
    !Number.isFinite(idNum) ||
    !Number.isInteger(idNum) ||
    !Number.isFinite(authDateNum) ||
    !hash ||
    !firstName
  ) {
    return { ok: false, error: "malformed" };
  }

  // Expiry-Check
  const ageSeconds = Math.floor(Date.now() / 1000) - authDateNum;
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, error: "expired" };
  }

  // data_check_string aus allen Feldern außer `hash`, sortiert.
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k === "hash") continue;
    if (v === undefined || v === null) continue;
    entries.push([k, String(v)]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = SHA-256(bot_token)
  const secretKey = createHash("sha256").update(token).digest();
  const computed = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time-Vergleich (länge gleich, sonst sofort false)
  if (computed.length !== hash.length) return { ok: false, error: "invalid_hash" };
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, error: "invalid_hash" };

  return {
    ok: true,
    payload: {
      id: idNum,
      first_name: firstName,
      last_name: typeof raw.last_name === "string" ? raw.last_name : undefined,
      username: typeof raw.username === "string" ? raw.username : undefined,
      photo_url:
        typeof raw.photo_url === "string" ? raw.photo_url : undefined,
      auth_date: authDateNum,
      hash,
    },
  };
}

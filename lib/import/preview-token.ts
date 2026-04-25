import { SignJWT, jwtVerify } from "jose";
import type { NormalizedListing } from "./types";

const TOKEN_TTL_SEC = 10 * 60; // 10 Minuten

function getSecret(): Uint8Array {
  const raw =
    process.env.IMPORT_PREVIEW_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (raw.length < 32) {
    throw new Error(
      "IMPORT_PREVIEW_SECRET (oder SUPABASE_SERVICE_ROLE_KEY als Fallback) fehlt oder ist zu kurz"
    );
  }
  return new TextEncoder().encode(raw);
}

export type PreviewPayload = {
  brokerId: string;
  rows: NormalizedListing[];
  signature: string;
};

export async function signPreviewToken(payload: PreviewPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SEC}s`)
    .sign(getSecret());
}

export async function verifyPreviewToken(token: string): Promise<PreviewPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  if (
    typeof payload.brokerId !== "string" ||
    !Array.isArray(payload.rows) ||
    typeof payload.signature !== "string"
  ) {
    throw new Error("invalid_token_payload");
  }
  return {
    brokerId: payload.brokerId,
    rows: payload.rows as NormalizedListing[],
    signature: payload.signature,
  };
}

import { cookies } from "next/headers";

const COOKIE_NAME = "home4u_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type SessionInfo = {
  anonymousId: string;
  fresh: boolean; // true wenn in diesem Request neu gesetzt
};

/**
 * Liefert die anonyme Session-ID aus Cookie oder legt eine neue an.
 * Server-Side only — nutzt next/headers cookies().
 */
export async function getOrCreateAnonymousSession(): Promise<SessionInfo> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing && /^[a-zA-Z0-9_-]{16,64}$/.test(existing)) {
    return { anonymousId: existing, fresh: false };
  }
  const anonymousId = cryptoRandomId();
  try {
    store.set(COOKIE_NAME, anonymousId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  } catch {
    // in reinen Server-Components ohne Response kann .set werfen — dann
    // gibt der Caller den Cookie manuell in der Response zurück.
  }
  return { anonymousId, fresh: true };
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export const ANONYMOUS_COOKIE_NAME = COOKIE_NAME;

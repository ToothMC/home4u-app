import { NextResponse, type NextRequest } from "next/server";

/**
 * Sprache per Link vorgeben: /?lang=en setzt das Cookie home4u_lang und
 * leitet auf dieselbe URL ohne den lang-Parameter weiter. Damit lassen sich
 * Kampagnen-Links (Mailings, Anzeigen) direkt in der richtigen Sprache
 * verschicken, statt den Besucher auf den Flaggen-Picker im Header zu
 * verweisen.
 *
 * Alle anderen Query-Parameter (utm_source & Co.) bleiben erhalten.
 * Der Redirect ist schleifensicher, weil lang danach nicht mehr in der URL
 * steht.
 *
 * Die Fallback-Erkennung ohne Cookie (Accept-Language des Browsers) steckt
 * nicht hier, sondern in lib/lang/preferred-language.ts — dort kostet sie
 * keinen zusaetzlichen Redirect.
 */

const SUPPORTED = ["de", "en", "ru", "el", "zh"] as const;
type SupportedLang = (typeof SUPPORTED)[number];

const COOKIE_NAME = "home4u_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr, wie im LanguageFlagPicker
const QUERY_PARAM = "lang";

function normalizeLang(value: string | null): SupportedLang | null {
  if (!value) return null;
  // "en-GB" -> "en", "el-CY" -> "el"
  const short = value.trim().toLowerCase().slice(0, 2);
  return (SUPPORTED as readonly string[]).includes(short)
    ? (short as SupportedLang)
    : null;
}

export function middleware(request: NextRequest) {
  const requested = normalizeLang(request.nextUrl.searchParams.get(QUERY_PARAM));
  if (!requested) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.searchParams.delete(QUERY_PARAM);

  const response = NextResponse.redirect(target, 307);
  response.cookies.set({
    name: COOKIE_NAME,
    value: requested,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export const config = {
  // Keine API-Routen, keine Next-internen Assets, keine Dateien mit Endung.
  matcher: ["/((?!api/|_next/|.*\\.[^/]+$).*)"],
};

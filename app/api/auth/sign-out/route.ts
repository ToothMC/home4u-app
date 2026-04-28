import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ANONYMOUS_COOKIE_NAME } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // ignore — Cookies werden trotzdem durch @supabase/ssr geleert
  }
  // Anon-Session-Cookie zurücksetzen, damit der ausgeloggte Besucher
  // nicht mehr die anonymen Pre-Login-Chats sieht — die hängen am
  // alten home4u_sid und gehören eigentlich noch zum gerade
  // abgemeldeten Account.
  try {
    const store = await cookies();
    store.delete(ANONYMOUS_COOKIE_NAME);
  } catch {
    // best-effort
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

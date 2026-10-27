import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { loadLastConversation } from "@/lib/repo/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nach 24 h ohne Nachricht startet /chat frisch. Ein älterer Verlauf würde
 *  überholte Aussagen zeigen (z. B. „Suche gespeichert" für eine längst
 *  gelöschte Suche) und Sophie mit veraltetem Kontext weiterarbeiten lassen. */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Liefert die letzte Konversation des eingeloggten Users.
 *
 * Anonyme User bekommen IMMER null zurück — auch wenn ihr anonymous_id-
 * Cookie eine alte Konversation kennt. Begründung: ein nicht-eingeloggter
 * Besucher (oder der nächste User auf einem geteilten Gerät) erwartet
 * einen frischen Chat, nicht die Historie einer vergangenen Session.
 * Persistente Chat-Historie ist ein Login-Feature.
 *
 * Eingeloggt: nur wenn die letzte Nachricht < 24 h her ist, sonst null.
 */
export async function GET(_req: NextRequest) {
  const authUser = await getAuthUser();

  if (!authUser) {
    return new Response(
      JSON.stringify({ ok: true, user: null, conversation: null }),
      { headers: { "content-type": "application/json" } }
    );
  }

  const history = await loadLastConversation({
    anonymousId: null,
    userId: authUser.id,
    activeWithinMs: RESUME_WINDOW_MS,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id: authUser.id, email: authUser.email },
      conversation: history,
    }),
    { headers: { "content-type": "application/json" } }
  );
}

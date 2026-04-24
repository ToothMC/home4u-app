import { NextRequest } from "next/server";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { getAuthUser } from "@/lib/supabase/auth";
import { loadLastConversation } from "@/lib/repo/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await getOrCreateAnonymousSession();
  const authUser = await getAuthUser();

  const history = await loadLastConversation({
    anonymousId: session.anonymousId,
    userId: authUser?.id ?? null,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      user: authUser ? { id: authUser.id, email: authUser.email } : null,
      conversation: history,
    }),
    { headers: { "content-type": "application/json" } }
  );
}

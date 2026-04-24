import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return json({ error: "supabase_not_configured" }, 500);
  }

  const session = await getOrCreateAnonymousSession();

  const { data, error } = await supabase.rpc("match_seeker_outbox", {
    p_anonymous_id: session.anonymousId,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, matches: data ?? [] });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

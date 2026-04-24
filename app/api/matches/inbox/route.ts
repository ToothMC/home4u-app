import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return json({ error: "supabase_not_configured" }, 500);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "not_authenticated" }, 401);

  const { data, error } = await supabase.rpc("match_owner_inbox");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, matches: data ?? [] });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

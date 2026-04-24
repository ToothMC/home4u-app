import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  match_id: z.string().uuid(),
  accept: z.boolean(),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return json({ error: "invalid_body", detail: String(err) }, 400);
  }

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

  const { data, error } = await supabase.rpc("owner_respond_match", {
    p_match_id: body.match_id,
    p_accept: body.accept,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, result: data });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

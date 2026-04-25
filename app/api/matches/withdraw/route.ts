// POST /api/matches/withdraw — Suchender zieht eine Anfrage zurück.

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ match_id: z.string().uuid() });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }

  const user = await getAuthUser();
  let supabase;
  let anonymousId: string | null = null;
  if (user) {
    try {
      supabase = await createSupabaseServerClient();
    } catch {
      return Response.json({ error: "supabase_not_configured" }, { status: 503 });
    }
  } else {
    supabase = createSupabaseServiceClient();
    if (!supabase) {
      return Response.json({ error: "supabase_not_configured" }, { status: 503 });
    }
    const session = await getOrCreateAnonymousSession();
    anonymousId = session.anonymousId;
  }

  const { data, error } = await supabase.rpc("seeker_withdraw_match", {
    p_match_id: parsed.data.match_id,
    p_anonymous_id: anonymousId,
  });
  if (error) {
    console.error("[matches/withdraw] rpc failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  const payload = data as { ok: boolean; error?: string };
  if (!payload.ok) {
    return Response.json({ error: payload.error ?? "unknown" }, { status: 400 });
  }
  return Response.json({ ok: true });
}

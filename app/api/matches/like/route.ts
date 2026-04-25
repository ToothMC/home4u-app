// POST /api/matches/like — Suchender bekundet Interesse an einem Listing.
// Ruft die seeker_request_match RPC auf (Migration 0007). Wenn der Owner
// bereits ja gesagt hatte, gibt connected_at sofort zurück.

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ listing_id: z.string().uuid() });

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
  // Wichtig: für eingeloggte User den Session-Client (auth.uid() wird in der
  // RPC genutzt) — service-role hätte keine User-Identity. Anonyme Visitors
  // gehen über service-role + Cookie-Session.
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

  const { data, error } = await supabase.rpc("seeker_request_match", {
    p_anonymous_id: anonymousId,
    p_listing_id: parsed.data.listing_id,
  });
  if (error) {
    console.error("[matches/like] rpc failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  const payload = data as { ok: boolean; match_id?: string; error?: string; connected_at?: string };
  if (!payload.ok) {
    return Response.json({ error: payload.error ?? "unknown" }, { status: 400 });
  }
  return Response.json({
    match_id: payload.match_id,
    connected: Boolean(payload.connected_at),
  });
}

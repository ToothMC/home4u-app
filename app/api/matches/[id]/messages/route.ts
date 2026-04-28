import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/matches/[id]/messages       — Thread laden
 * POST /api/matches/[id]/messages       — neue Nachricht
 *
 * Auth-only. Erlaubt nur Teilnehmer (Seeker oder Owner) eines connected
 * Matches. Authorisierung doppelt geprüft: server-seitig + RLS.
 */

async function authorizeMatch(matchId: string, userId: string) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false as const, status: 500, error: "supabase" };

  const { data: match, error } = await supabase
    .from("matches")
    .select(
      `id, connected_at,
       search_profiles!inner ( user_id ),
       listings!inner ( owner_user_id )`
    )
    .eq("id", matchId)
    .maybeSingle();

  if (error || !match) {
    return { ok: false as const, status: 404, error: "not_found" };
  }
  if (!match.connected_at) {
    return { ok: false as const, status: 403, error: "not_connected" };
  }

  const profile = match.search_profiles as unknown as { user_id: string | null };
  const listing = match.listings as unknown as { owner_user_id: string | null };
  const isSeeker = profile.user_id === userId;
  const isOwner = listing.owner_user_id === userId;
  if (!isSeeker && !isOwner) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  return { ok: true as const, supabase };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const auth = await authorizeMatch(id, user.id);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("match_messages")
    .select("id, sender_user_id, content, created_at, read_at")
    .eq("match_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return Response.json(
      { error: "load_failed", detail: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    messages: (data ?? []).map((m) => ({
      ...m,
      mine: m.sender_user_id === user.id,
    })),
    me: user.id,
  });
}

const postSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }

  const auth = await authorizeMatch(id, user.id);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("match_messages")
    .insert({
      match_id: id,
      sender_user_id: user.id,
      content: parsed.data.content,
    })
    .select("id, content, created_at")
    .single();

  if (error || !data) {
    return Response.json(
      { error: "insert_failed", detail: error?.message ?? "unknown" },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, message: { ...data, mine: true } });
}

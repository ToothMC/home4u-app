// PATCH + DELETE eines Suchprofils — nur eigener User oder cookie-anonymous-id.

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findMatchesForSession } from "@/lib/repo/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    location: z.string().min(1).max(160).optional(),
    type: z.enum(["rent", "sale"]).optional(),
    budget_min: z.number().min(0).max(50_000_000).nullable().optional(),
    budget_max: z.number().min(0).max(50_000_000).optional(),
    rooms: z.number().int().min(0).max(20).nullable().optional(),
    move_in_date: z.string().nullable().optional(),
    household: z.enum(["single", "couple", "family", "shared"]).nullable().optional(),
    lifestyle_tags: z.array(z.string().max(40)).max(20).nullable().optional(),
    pets: z.boolean().nullable().optional(),
    free_text: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
    notify_new_matches: z.boolean().optional(),
    published_as_wanted: z.boolean().optional(),
  })
  .strict();

async function loadAndAuthorize(id: string) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false as const, status: 503, error: "supabase_not_configured" };

  const user = await getAuthUser();
  const session = user ? null : await getOrCreateAnonymousSession();

  const { data: row, error } = await supabase
    .from("search_profiles")
    .select("user_id, anonymous_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!row) return { ok: false as const, status: 404, error: "not_found" };

  const ownedByUser = user && row.user_id === user.id;
  const ownedByAnon = session?.anonymousId && row.anonymous_id === session.anonymousId;
  if (!ownedByUser && !ownedByAnon) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  return {
    ok: true as const,
    supabase,
    userId: ownedByUser ? user.id : undefined,
    anonymousId: ownedByAnon ? session.anonymousId : undefined,
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "empty_patch" }, { status: 400 });
  }

  const auth = await loadAndAuthorize(id);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  // Anonyme Profile dürfen nicht öffentlich publiziert werden — kein
  // Email-Delivery, keine Inbox-Erreichbarkeit. Toggle wird stillschweigend
  // auf false geclamped (besser als 400 — der User könnte verwirrt sein
  // warum sein Toggle nicht klickbar ist; im Frontend disablen wir ihn nicht).
  if (parsed.data.published_as_wanted === true && !auth.userId) {
    parsed.data.published_as_wanted = false;
  }

  const { data, error } = await auth.supabase
    .from("search_profiles")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[searches/PATCH] failed", error);
    return Response.json(
      { error: "update_failed", detail: error?.message ?? "unknown" },
      { status: 500 }
    );
  }

  // Regel: jede Profil-Änderung löst eine neue Suche aus. Wir liefern
  // Trefferzahl zurück damit das Frontend (Edit-Form) die /matches-Anzeige
  // direkt refreshen oder einen "X neue Treffer"-Toast zeigen kann.
  // Best-Effort — bei Fehler bleibt der PATCH trotzdem erfolgreich.
  let matchCount: number | null = null;
  try {
    const matches = await findMatchesForSession(
      { userId: auth.userId, anonymousId: auth.anonymousId },
      50
    );
    matchCount = matches.length;
  } catch (e) {
    console.warn("[searches/PATCH] match-refresh failed", e);
  }

  return Response.json({ ok: true, id, match_count: matchCount });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await loadAndAuthorize(id);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const { error } = await auth.supabase.from("search_profiles").delete().eq("id", id);
  if (error) {
    return Response.json(
      { error: "delete_failed", detail: error.message },
      { status: 500 }
    );
  }
  return Response.json({ ok: true });
}

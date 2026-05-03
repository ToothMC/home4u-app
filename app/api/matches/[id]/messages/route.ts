import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { translate } from "@/lib/translation/translate";
import type { Lang } from "@/lib/translation/glossary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/matches/[id]/messages       — Thread laden
 * POST /api/matches/[id]/messages       — neue Nachricht
 *
 * Auth-only. Erlaubt nur Teilnehmer (Seeker oder Owner) eines connected
 * Matches. Authorisierung doppelt geprüft: server-seitig + RLS.
 *
 * Auto-Translation: beim POST wird der Text in die preferred_language des
 * Empfängers übersetzt (Haiku, mit Cache + Domain-Glossar). GET liefert
 * `display_text` bereits in Viewer-Sprache plus Original zum Aufklappen.
 */

const TRANSLATABLE_LANGS: ReadonlyArray<Lang> = ["de", "en", "ru", "el"];

function isTranslatableLang(s: string | null | undefined): s is Lang {
  return !!s && (TRANSLATABLE_LANGS as readonly string[]).includes(s);
}

async function loadProfileLang(
  supabase: SupabaseClient,
  userId: string
): Promise<Lang | null> {
  const { data } = await supabase
    .from("profiles")
    .select("preferred_language")
    .eq("id", userId)
    .maybeSingle();
  const raw = data?.preferred_language as string | null | undefined;
  return isTranslatableLang(raw) ? raw : null;
}

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
  const counterpartyId = isSeeker ? listing.owner_user_id : profile.user_id;
  return { ok: true as const, supabase, counterpartyId };
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
    .select(
      "id, sender_user_id, content, created_at, read_at, original_language, translations"
    )
    .eq("match_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return Response.json(
      { error: "load_failed", detail: error.message },
      { status: 500 }
    );
  }

  const viewerLang = await loadProfileLang(auth.supabase, user.id);

  return Response.json({
    ok: true,
    viewer_lang: viewerLang,
    messages: (data ?? []).map((m) => {
      const mine = m.sender_user_id === user.id;
      const translations = (m.translations ?? {}) as Partial<Record<Lang, string>>;
      const translated =
        !mine && viewerLang && viewerLang !== m.original_language
          ? translations[viewerLang]
          : null;
      return {
        id: m.id,
        sender_user_id: m.sender_user_id,
        content: m.content,
        created_at: m.created_at,
        read_at: m.read_at,
        mine,
        original_language: (m.original_language as Lang | null) ?? null,
        display_text: translated ?? m.content,
        is_translated: !!translated,
      };
    }),
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

  // Auto-Translation vorbereiten: Sender + Empfänger-Sprache laden, in
  // Empfänger-Sprache übersetzen wenn beide bekannt und unterschiedlich.
  const senderLang = await loadProfileLang(auth.supabase, user.id);
  const receiverLang = auth.counterpartyId
    ? await loadProfileLang(auth.supabase, auth.counterpartyId)
    : null;

  let translations: Partial<Record<Lang, string>> = {};
  if (senderLang && receiverLang && senderLang !== receiverLang) {
    const result = await translate({
      text: parsed.data.content,
      source_lang: senderLang,
      target_langs: [receiverLang],
      context: "chat",
    });
    if (!result.error) {
      translations = result.translations;
    } else {
      console.warn("[messages.POST] translate failed", {
        match_id: id,
        error: result.error,
      });
    }
  }

  const { data, error } = await auth.supabase
    .from("match_messages")
    .insert({
      match_id: id,
      sender_user_id: user.id,
      content: parsed.data.content,
      original_language: senderLang,
      translations,
    })
    .select("id, content, created_at, original_language, translations")
    .single();

  if (error || !data) {
    return Response.json(
      { error: "insert_failed", detail: error?.message ?? "unknown" },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    message: {
      id: data.id,
      content: data.content,
      created_at: data.created_at,
      original_language: data.original_language,
      mine: true,
      // Eigene Nachrichten zeigen immer das Original
      display_text: data.content,
      is_translated: false,
    },
  });
}

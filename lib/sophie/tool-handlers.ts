import {
  upsertSearchProfile,
  updateSearchProfileField,
} from "@/lib/repo/search-profiles";
import { findMatchesForSession } from "@/lib/repo/listings";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ToolContext = {
  anonymousId?: string;
  userId?: string;
  conversationId?: string;
};

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async create_search_profile(input, ctx) {
    if (!ctx.anonymousId) {
      return { ok: false, error: "missing_session" };
    }
    const location = String(input.location ?? "").trim();
    if (!location) return { ok: false, error: "location_required" };

    const result = await upsertSearchProfile({
      anonymousId: ctx.anonymousId,
      location,
      budget_min: asNumber(input.budget_min),
      budget_max: asNumber(input.budget_max) ?? 0,
      rooms: asNumber(input.rooms),
      move_in_date: asString(input.move_in_date),
      household: asString(input.household),
      lifestyle_tags: asStringArray(input.lifestyle_tags),
      pets: asBoolean(input.pets),
    });

    if (!result) {
      return {
        ok: true,
        data: {
          persisted: false,
          note:
            "Supabase nicht konfiguriert — Profil wurde nicht gespeichert, Chat funktioniert trotzdem.",
          snapshot: input,
        },
      };
    }
    return { ok: true, data: { persisted: true, profile_id: result.id } };
  },

  async update_search_profile(input, ctx) {
    if (!ctx.anonymousId) return { ok: false, error: "missing_session" };
    const field = String(input.field ?? "");
    if (!field) return { ok: false, error: "field_required" };

    const ok = await updateSearchProfileField(
      ctx.anonymousId,
      field,
      input.value
    );
    return {
      ok: true,
      data: {
        persisted: ok,
        note: ok
          ? undefined
          : "Kein bestehendes Profil gefunden oder Supabase nicht konfiguriert.",
      },
    };
  },

  async find_matches(input, ctx) {
    if (!ctx.anonymousId && !ctx.userId) {
      return { ok: false, error: "missing_session" };
    }
    const limit = Math.min(10, Math.max(1, Number(input.limit) || 3));
    const matches = await findMatchesForSession(
      { anonymousId: ctx.anonymousId, userId: ctx.userId },
      limit
    );
    return {
      ok: true,
      data: {
        count: matches.length,
        matches: matches.map((m) => ({
          id: m.id,
          city: m.location_city,
          district: m.location_district,
          price: m.price,
          currency: m.currency,
          rooms: m.rooms,
          size_sqm: m.size_sqm,
          score: Math.round(m.score * 100) / 100,
        })),
      },
    };
  },

  async confirm_match_request(input) {
    // TODO: echte Matches-Tabelle befüllen sobald Matching-Job + Listings da sind
    return {
      ok: true,
      data: {
        listing_id: input.listing_id,
        status: "outreach_queued",
        message:
          "Anbieter wird kontaktiert sobald die Outreach-Pipeline live ist.",
      },
    };
  },

  async escalate_to_human(input, ctx) {
    const supabase = createSupabaseServiceClient();
    if (supabase && ctx.conversationId) {
      const { error } = await supabase.from("moderation_queue").insert({
        conversation_id: ctx.conversationId,
        sophie_draft: JSON.stringify(input),
        prompt_version: "escalation",
        tags: ["escalation", String(input.reason ?? "other")],
      });
      if (error) console.error("[escalate] insert failed", error);
    }
    return {
      ok: true,
      data: {
        escalated: true,
        message:
          "Ein Mensch meldet sich sobald das Moderations-Team im Co-Pilot-Modus live ist.",
      },
    };
  },
};

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return { ok: false, error: `unknown_tool:${name}` };
  const safeInput = (input ?? {}) as Record<string, unknown>;
  try {
    return await handler(safeInput, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  return undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return undefined;
}

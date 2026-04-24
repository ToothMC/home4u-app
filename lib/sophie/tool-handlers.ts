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
    if (!ctx.userId && !ctx.anonymousId) {
      return { ok: false, error: "missing_session" };
    }
    const location = String(input.location ?? "").trim();
    if (!location) return { ok: false, error: "location_required" };

    const ownerKey = ctx.userId
      ? { userId: ctx.userId }
      : { anonymousId: ctx.anonymousId as string };

    const result = await upsertSearchProfile({
      ...ownerKey,
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
    if (!ctx.userId && !ctx.anonymousId) {
      return { ok: false, error: "missing_session" };
    }
    const field = String(input.field ?? "");
    if (!field) return { ok: false, error: "field_required" };

    const ok = await updateSearchProfileField(
      { userId: ctx.userId, anonymousId: ctx.anonymousId },
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

  async create_listing(input, ctx) {
    if (!ctx.userId) {
      return {
        ok: false,
        error: "not_authenticated",
        data: {
          message:
            "Zum Inserieren bitte oben rechts 'Anmelden' klicken und E-Mail bestätigen. Danach kannst du das Inserat direkt anlegen.",
        },
      };
    }
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "supabase_not_configured" };
    }

    const city = String(input.location_city ?? "").trim();
    const type = String(input.type ?? "rent");
    const price = asNumber(input.price);
    const rooms = asNumber(input.rooms);
    if (!city || !price || !rooms) {
      return { ok: false, error: "missing_required_fields" };
    }

    const district = String(input.location_district ?? "").trim() || null;
    const sizeSqm = asNumber(input.size_sqm) ?? null;
    const contactChannel = asString(input.contact_channel) ?? null;
    const language = asString(input.language) ?? null;
    const notes = asString(input.notes) ?? null;
    const mediaUrls = asStringArray(input.media_urls)?.filter((u) =>
      u.startsWith("http")
    ) ?? null;

    // Dedup-Hash stabil aus Owner + Stadt + Preis + Zimmer (verhindert Duplikate
    // vom selben Owner, erlaubt verschiedene Inserate wenn die Parameter abweichen).
    const dedupHash = [
      "direct",
      ctx.userId.slice(0, 8),
      city.toLowerCase(),
      district?.toLowerCase() ?? "",
      String(price),
      String(rooms),
    ].join(":");

    const { data, error } = await supabase
      .from("listings")
      .insert({
        source: "direct",
        type,
        status: "active",
        location_city: city,
        location_district: district,
        location_raw: district ? `${city}, ${district}` : city,
        price,
        currency: "EUR",
        price_period: type === "rent" ? "month" : "total",
        rooms,
        size_sqm: sizeSqm,
        contact_channel: contactChannel,
        language,
        owner_user_id: ctx.userId,
        dedup_hash: dedupHash,
        media: mediaUrls ?? [],
      })
      .select("id")
      .single();

    if (error) {
      console.error("[create_listing] insert failed", error);
      return {
        ok: false,
        error: "insert_failed",
        data: { detail: error.message },
      };
    }

    return {
      ok: true,
      data: {
        listing_id: data.id,
        message: `Inserat angelegt: ${city}${district ? " · " + district : ""}, ${rooms} Zimmer, ${price} €.`,
        notes_ack: notes ? true : false,
        media_count: mediaUrls?.length ?? 0,
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

  async confirm_match_request(input, ctx) {
    const listingId = asString(input.listing_id);
    if (!listingId) {
      return { ok: false, error: "missing_listing_id" };
    }
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "supabase_not_configured" };
    }
    const { data, error } = await supabase.rpc("seeker_request_match", {
      p_anonymous_id: ctx.anonymousId ?? null,
      p_listing_id: listingId,
    });
    if (error) {
      console.error("[confirm_match_request] rpc failed", error);
      return { ok: false, error: error.message };
    }
    const payload = data as { ok: boolean; match_id?: string; error?: string };
    if (!payload.ok) {
      return { ok: false, error: payload.error ?? "unknown_error" };
    }
    return {
      ok: true,
      data: {
        listing_id: listingId,
        match_id: payload.match_id,
        message:
          "Anfrage ist raus. Sobald der Anbieter zusagt, tauschen wir den Kontakt aus — du siehst das Ergebnis in deinem Dashboard unter 'Meine Anfragen'.",
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

import {
  upsertSearchProfile,
  updateSearchProfileField,
} from "@/lib/repo/search-profiles";
import { findMatchesForSession } from "@/lib/repo/listings";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { triggerOutreachForMatch } from "@/lib/listings/outreach";
import {
  embedAndStoreListing,
  embedAndStoreSearchProfile,
} from "@/lib/embeddings";
import { translate } from "@/lib/translation/translate";
import type { Lang } from "@/lib/translation/glossary";

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type UserRole = "seeker" | "owner" | "agent" | "admin" | null;

export type ToolContext = {
  anonymousId?: string;
  userId?: string;
  conversationId?: string;
  role?: UserRole;
};

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async set_user_role(input, ctx) {
    const role = String(input.role ?? "");
    if (!["seeker", "owner", "agent"].includes(role)) {
      return { ok: false, error: "invalid_role" };
    }
    if (!ctx.userId) {
      return {
        ok: false,
        error: "not_authenticated",
        data: {
          message:
            "Ich merke mir das gerne — aber damit's sich auf deinen Account legt, melde dich bitte oben rechts an. Dann setze ich die Rolle fest.",
        },
      };
    }
    const supabase = createSupabaseServiceClient();
    if (!supabase) return { ok: false, error: "supabase_not_configured" };

    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", ctx.userId);

    if (error) {
      console.error("[set_user_role] update failed", error);
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      data: {
        role,
        message:
          role === "seeker"
            ? "Rolle auf 'Suchender' gesetzt. Lass uns dein Profil anlegen."
            : role === "owner"
              ? "Rolle auf 'Eigentümer' gesetzt. Beschreib mir deine Immobilie."
              : "Rolle auf 'Makler' gesetzt. Ich helfe dir mit deinen Inseraten.",
      },
    };
  },

  async create_search_profile(input, ctx) {
    if (!ctx.userId && !ctx.anonymousId) {
      return { ok: false, error: "missing_session" };
    }
    const location = String(input.location ?? "").trim();
    if (!location) return { ok: false, error: "location_required" };

    // type ist via Tool-Schema required — defensive trotzdem prüfen.
    // DB-Default ist 'rent' → ohne explizites type würde Sophie's "Kauf"-
    // Intent verloren gehen und der Match-Hard-Filter (l.type=v_profile.type)
    // gibt nur Miet-Listings zurück.
    const rawType = String(input.type ?? "").trim().toLowerCase();
    if (rawType !== "rent" && rawType !== "sale") {
      return {
        ok: false,
        error: "type_required",
        data: {
          message:
            "Bevor ich die Suche anlege: möchtest du mieten oder kaufen?",
        },
      };
    }
    const type: "rent" | "sale" = rawType;

    // property_type optional — wenn gesetzt, harter Filter auf Listing-Type.
    // 'plot' z.B. filtert Apartments/Häuser raus, 'apartment' filtert Plots raus.
    const rawPT = String(input.property_type ?? "").trim().toLowerCase();
    const property_type =
      rawPT === "apartment" || rawPT === "house" || rawPT === "room" || rawPT === "plot"
        ? (rawPT as "apartment" | "house" | "room" | "plot")
        : undefined;

    const ownerKey = ctx.userId
      ? { userId: ctx.userId }
      : { anonymousId: ctx.anonymousId as string };

    const result = await upsertSearchProfile({
      ...ownerKey,
      conversationId: ctx.conversationId ?? null,
      type,
      property_type,
      location,
      budget_min: asNumber(input.budget_min),
      budget_max: asNumber(input.budget_max) ?? 0,
      rooms: asNumber(input.rooms),
      rooms_strict: asBoolean(input.rooms_strict) ?? false,
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
    if ("error" in result) {
      if (result.error === "limit_reached") {
        return {
          ok: false,
          error: "limit_reached",
          data: {
            message:
              "Du hast bereits 3 aktive Suchen. Bitte lösche zuerst eine im Dashboard, dann lege ich eine neue an.",
          },
        };
      }
      return { ok: false, error: result.error };
    }
    // Embedding fire-and-forget — Profil ist persistiert, Soft-Match ist Best-Effort
    void embedAndStoreSearchProfile(result.id, {
      type,
      property_type,
      location,
      budget_min: asNumber(input.budget_min),
      budget_max: asNumber(input.budget_max),
      rooms: asNumber(input.rooms),
      household: asString(input.household),
      lifestyle_tags: asStringArray(input.lifestyle_tags),
      free_text: asString(input.free_text),
    });
    // Direkt nach Profil-Save eine frische Suche fahren, damit Sophie in der
    // gleichen Antwort die Trefferzahl nennt — Regel: jede Profil-Änderung
    // löst eine neue Suche aus.
    const fresh = await runFreshMatchForCtx(ctx);
    return {
      ok: true,
      data: { persisted: true, profile_id: result.id, ...fresh },
    };
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
    if (ok) {
      // Bei jedem Profil-Update Embedding neu rechnen (Best-Effort, async)
      void refreshProfileEmbedding(ctx);
    }
    // Auch bei Field-Update: sofort eine frische Suche laufen lassen, damit
    // Sophie z.B. nach "Budget 300→400" direkt sagen kann "jetzt 12 Treffer".
    const fresh = ok ? await runFreshMatchForCtx(ctx) : { match_count: null };
    return {
      ok: true,
      data: {
        persisted: ok,
        note: ok
          ? undefined
          : "Kein bestehendes Profil gefunden oder Supabase nicht konfiguriert.",
        ...fresh,
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

    // original_language ableiten (input.language falls valid, sonst null →
    // wird beim ersten Übersetzungs-Call automatisch detektiert).
    const originalLang = normalizeLang(language);

    // Auto-Title aus Stadt + Zimmer + Preis bauen, wenn nicht expliziter Titel —
    // der Indexer macht das auch so. Notes wird die Beschreibung.
    const autoTitle = `${rooms}-Zimmer ${type === "rent" ? "Miete" : "Kauf"} in ${city}${district ? ` · ${district}` : ""}`;
    const description = notes ?? autoTitle;

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
        title: autoTitle,
        description,
        original_language: originalLang,
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

    // Embedding fire-and-forget — Listing ist persistiert, Soft-Match ist Best-Effort
    void embedAndStoreListing(data.id, {
      type: type as "rent" | "sale",
      location_city: city,
      location_district: district,
      price,
      currency: "EUR",
      rooms,
      size_sqm: sizeSqm,
      language,
      raw_text: notes,
    });

    // Auto-i18n fire-and-forget — Listing ist sofort sichtbar im Original,
    // Übersetzungen erscheinen wenn Haiku zurück ist (typisch <2s).
    void translateListingFields({
      listingId: data.id,
      title: autoTitle,
      description,
      sourceLang: originalLang,
    });

    return {
      ok: true,
      data: {
        listing_id: data.id,
        message: `Inserat angelegt: ${city}${district ? " · " + district : ""}, ${rooms} Zimmer, ${price} €. Übersetzung in DE/EN/RU/EL läuft im Hintergrund.`,
        notes_ack: notes ? true : false,
        media_count: mediaUrls?.length ?? 0,
        i18n_pending: true,
      },
    };
  },

  async add_photos_to_listing(input, ctx) {
    if (!ctx.userId) {
      return {
        ok: false,
        error: "not_authenticated",
        data: { message: "Bitte oben rechts anmelden, dann kann ich Fotos hinzufügen." },
      };
    }
    const supabase = createSupabaseServiceClient();
    if (!supabase) return { ok: false, error: "supabase_not_configured" };

    const listingId = asString(input.listing_id);
    const photoUrls = asStringArray(input.photo_urls)?.filter((u) =>
      u.startsWith("http")
    );
    if (!listingId) return { ok: false, error: "missing_listing_id" };
    if (!photoUrls || photoUrls.length === 0) {
      return { ok: false, error: "no_photo_urls" };
    }

    const { data: listing, error: loadErr } = await supabase
      .from("listings")
      .select("id, owner_user_id, media")
      .eq("id", listingId)
      .maybeSingle();
    if (loadErr || !listing) {
      return {
        ok: false,
        error: "listing_not_found",
        data: { detail: loadErr?.message },
      };
    }
    if (listing.owner_user_id !== ctx.userId) {
      return { ok: false, error: "not_listing_owner" };
    }

    const existing = Array.isArray(listing.media) ? listing.media : [];
    // Dedup, Reihenfolge: vorhandene zuerst, neue dahinter
    const merged = Array.from(new Set([...existing, ...photoUrls]));

    const { error: updErr } = await supabase
      .from("listings")
      .update({ media: merged })
      .eq("id", listingId);
    if (updErr) {
      return { ok: false, error: "update_failed", data: { detail: updErr.message } };
    }

    return {
      ok: true,
      data: {
        listing_id: listingId,
        added: photoUrls.length,
        total_photos: merged.length,
        message: `${photoUrls.length} Foto(s) zum Inserat hinzugefügt — jetzt ${merged.length} insgesamt.`,
      },
    };
  },

  async find_matches(input, ctx) {
    if (!ctx.anonymousId && !ctx.userId) {
      return { ok: false, error: "missing_session" };
    }
    // Default + Cap: aligned mit /matches-Page (50 max). Sophie nennt
    // typischerweise nur die Trefferzahl + Hinweis auf /matches, also reicht
    // ein höherer Default — sonst sagt sie "3 Treffer" während die Page 50 zeigt.
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 50));
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

    // Outreach an den Inserenten — best-effort, blockiert die Sophie-Response nicht.
    if (payload.match_id) {
      try {
        const outreach = await triggerOutreachForMatch(payload.match_id);
        console.info("[confirm_match_request] outreach", outreach);
      } catch (e) {
        console.error("[confirm_match_request] outreach threw", e);
      }
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

/**
 * Frische Suche direkt nach einer Profil-Änderung. Sophies Response-Modell
 * sieht in `match_count` und `top_matches` den neuen Stand und kann ihn
 * natürlich in den Antworttext einbauen ("mit 400€ jetzt 12 Treffer").
 *
 * Best-Effort: bei Fehler/Supabase-Down liefern wir match_count=null,
 * blockieren aber nicht die Profil-Persistenz.
 */
async function runFreshMatchForCtx(ctx: ToolContext): Promise<{
  match_count: number | null;
  top_matches?: Array<{
    id: string;
    city: string;
    district: string | null;
    price: number;
    currency: string;
    rooms: number | null;
    size_sqm: number | null;
    score: number;
  }>;
  match_error?: string;
}> {
  if (!ctx.userId && !ctx.anonymousId) return { match_count: null };
  try {
    const matches = await findMatchesForSession(
      { anonymousId: ctx.anonymousId, userId: ctx.userId },
      12
    );
    return {
      match_count: matches.length,
      top_matches: matches.slice(0, 3).map((m) => ({
        id: m.id,
        city: m.location_city,
        district: m.location_district,
        price: m.price,
        currency: m.currency,
        rooms: m.rooms,
        size_sqm: m.size_sqm,
        score: Math.round(m.score * 100) / 100,
      })),
    };
  } catch (err) {
    return {
      match_count: null,
      match_error: err instanceof Error ? err.message : "match_failed",
    };
  }
}

async function refreshProfileEmbedding(ctx: ToolContext): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return;
  const keyColumn = ctx.userId ? "user_id" : "anonymous_id";
  const keyValue = ctx.userId ?? ctx.anonymousId;
  if (!keyValue) return;
  const { data } = await supabase
    .from("search_profiles")
    .select(
      "id, location, budget_min, budget_max, rooms, type, property_type, household, lifestyle_tags, free_text"
    )
    .eq(keyColumn, keyValue)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return;
  await embedAndStoreSearchProfile(data.id, {
    location: data.location,
    budget_min: data.budget_min,
    budget_max: data.budget_max,
    rooms: data.rooms,
    type: data.type,
    property_type: data.property_type,
    household: data.household,
    lifestyle_tags: data.lifestyle_tags,
    free_text: data.free_text,
  });
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

const ALLOWED_LANGS_LOCAL: readonly Lang[] = ["de", "en", "ru", "el"] as const;

function normalizeLang(s: string | null | undefined): Lang | null {
  if (!s) return null;
  const short = s.slice(0, 2).toLowerCase();
  return ALLOWED_LANGS_LOCAL.includes(short as Lang) ? (short as Lang) : null;
}

/**
 * Listing-Titel + Beschreibung in alle 4 Zielsprachen übersetzen und
 * in listings.title_i18n / description_i18n schreiben. Best-Effort —
 * fehlende Sprachen fallen beim Render auf das Original zurück.
 */
async function translateListingFields(args: {
  listingId: string;
  title: string;
  description: string;
  sourceLang: Lang | null;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return;

  const targets: Lang[] = (["de", "en", "ru", "el"] as Lang[]).filter(
    (l) => l !== args.sourceLang
  );
  if (targets.length === 0) return;

  try {
    const [titleOut, descOut] = await Promise.all([
      translate({
        text: args.title,
        source_lang: args.sourceLang ?? "auto",
        target_langs: targets,
        context: "listing",
      }),
      translate({
        text: args.description,
        source_lang: args.sourceLang ?? "auto",
        target_langs: targets,
        context: "listing",
      }),
    ]);

    await supabase
      .from("listings")
      .update({
        title_i18n: titleOut.translations,
        description_i18n: descOut.translations,
        // Wenn Quelle 'auto' war, jetzt die detektierte Sprache speichern
        original_language: args.sourceLang ?? titleOut.source_lang,
      })
      .eq("id", args.listingId);
  } catch (err) {
    console.warn("[translate-listing] failed", err);
  }
}

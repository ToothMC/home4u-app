// Tool-Handler für Sophies Tool-Use-Loop.
// Ohne Supabase: Logs + Echo des Inputs als Ergebnis.
// Mit Supabase (später): schreibt search_profiles, matches, opt_outs, moderation_queue.

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ToolContext = {
  userId?: string;
  conversationId?: string;
};

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async create_search_profile(input) {
    // TODO: Supabase insert into search_profiles
    console.log("[sophie-tool] create_search_profile", input);
    return { ok: true, data: { profile_id: "mock-" + Date.now(), input } };
  },

  async update_search_profile(input) {
    // TODO: Supabase update search_profiles set <field> = <value>
    console.log("[sophie-tool] update_search_profile", input);
    return { ok: true, data: { updated: input } };
  },

  async confirm_match_request(input) {
    // TODO: Supabase insert into matches with seeker_interest=true,
    //       trigger outreach-queue entry.
    console.log("[sophie-tool] confirm_match_request", input);
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

  async escalate_to_human(input) {
    // TODO: Supabase insert into moderation_queue with priority=urgent
    console.log("[sophie-tool] escalate_to_human", input);
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
  if (!handler) {
    return { ok: false, error: `unknown_tool:${name}` };
  }
  const safeInput = (input ?? {}) as Record<string, unknown>;
  try {
    return await handler(safeInput, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    phone: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    preferred_language: z
      .enum(["de", "en", "ru", "el"])
      .nullable()
      .optional(),
    contact_channel: z
      .enum(["email", "whatsapp", "telegram", "phone", "chat"])
      .nullable()
      .optional(),
    notification_email: z
      .string()
      .trim()
      .email()
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    // Hinweis: role ist absichtlich NICHT vom User editierbar.
    // Begründung: ein Nutzer ist auf Home4U gleichzeitig potentiell
    // Suchender + Anbieter + Makler. Das DB-Feld bleibt nur als
    // Dashboard-Default-Fokus, gesetzt durch Sophie wenn sie die
    // Hauptabsicht erkennt — kein UI-Lock.
  })
  .strict();

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, role, display_name, phone, preferred_language, contact_channel, notification_email, email"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json(
      { error: "load_failed", detail: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    profile: data ?? { id: user.id, role: null },
    auth_email: user.email,
  });
}

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

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

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 500 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return Response.json(
      { error: "update_failed", detail: error.message },
      { status: 500 }
    );
  }
  return Response.json({ ok: true });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { ANONYMOUS_COOKIE_NAME } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6,10}$/, "numeric code expected"),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return json({ error: "invalid_body", detail: String(err) }, 400);
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return json({ error: "supabase_not_configured" }, 500);
  }

  // verifyOtp mit type 'email' akzeptiert sowohl magic-link als auch signup-otp codes
  const verifyResult = await supabase.auth.verifyOtp({
    email: body.email,
    token: body.code,
    type: "email",
  });

  if (verifyResult.error || !verifyResult.data.user) {
    return json(
      { error: "verify_failed", detail: verifyResult.error?.message },
      400
    );
  }

  const user = verifyResult.data.user;

  // profiles-Row synchron halten (email, auth-Trigger legt bereits an).
  // Service-Client: profiles.email ist für Nutzer nicht mehr schreibbar
  // (Migration 20261027180000). Wert kommt aus dem verifizierten Auth-User.
  const service = createSupabaseServiceClient();
  if (service) {
    const { error: syncErr } = await service
      .from("profiles")
      .update({ email: user.email })
      .eq("id", user.id);
    if (syncErr) console.error("[verify-otp] profile email sync failed", syncErr);
  }

  // Anonymous-Session übernehmen
  const anonymousId = req.cookies.get(ANONYMOUS_COOKIE_NAME)?.value;
  let migrated: unknown = null;
  if (anonymousId) {
    const { data, error } = await supabase.rpc("migrate_anonymous_to_user", {
      p_anonymous_id: anonymousId,
    });
    if (error) {
      console.error("[verify-otp] migration failed", error);
    } else {
      migrated = data;
    }
  }

  return json({
    ok: true,
    user: { id: user.id, email: user.email },
    migrated,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

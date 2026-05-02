/**
 * Telegram-Login-Widget-Verifikation + Supabase-Session-Setup.
 *
 * Flow:
 *   1. Browser → POST /api/auth/telegram-login mit Telegram-Widget-Payload
 *   2. Wir verifizieren HMAC mit Bot-Token (lib/telegram/login-verify)
 *   3. Lookup oder create auth.users mit fake-Email "tg-<id>@telegram.home4u.local"
 *   4. generateLink({ type: 'magiclink' }) → hashed_token
 *   5. server-side verifyOtp({ token_hash, type: 'magiclink' }) — setzt Session-Cookie
 *   6. profiles.telegram_user_id + telegram_username updaten
 *   7. channel_identities upsert + verified_at
 *   8. Anonymous-Session übernehmen (gleiches Pattern wie verify-otp)
 *   9. Response { ok, redirect } — Client führt window.location aus
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { ANONYMOUS_COOKIE_NAME } from "@/lib/session";
import { verifyTelegramLogin } from "@/lib/telegram/login-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  next: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return json({ error: "invalid_body", detail: String(err) }, 400);
  }

  const verify = verifyTelegramLogin(body.payload);
  if (!verify.ok) {
    return json({ error: "telegram_verify_failed", reason: verify.error }, 401);
  }
  const tg = verify.payload;

  const service = createSupabaseServiceClient();
  if (!service) {
    return json({ error: "supabase_not_configured" }, 500);
  }

  // 1) profiles.telegram_user_id Lookup → existing auth.users
  let userId: string | null = null;
  let userEmail: string | null = null;
  const { data: existingProfile } = await service
    .from("profiles")
    .select("id, email")
    .eq("telegram_user_id", tg.id)
    .maybeSingle();
  if (existingProfile?.id) {
    userId = existingProfile.id;
    userEmail = existingProfile.email ?? null;
  }

  // 2) Falls nicht gefunden → User anlegen (admin createUser via Service-Role)
  if (!userId) {
    const fakeEmail = `tg-${tg.id}@telegram.home4u.local`;

    // Service-Role-Admin-Client (auth schema)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const created = await adminClient.auth.admin.createUser({
      email: fakeEmail,
      email_confirm: true,
      user_metadata: {
        telegram_id: tg.id,
        telegram_username: tg.username,
        first_name: tg.first_name,
        last_name: tg.last_name,
        provider: "telegram",
      },
    });
    if (created.error || !created.data.user) {
      console.error("[telegram-login] createUser failed", created.error);
      return json({ error: "create_user_failed", detail: created.error?.message }, 500);
    }
    userId = created.data.user.id;
    userEmail = fakeEmail;

    // profiles-Row updaten (auth-trigger legt sie automatisch an)
    await service
      .from("profiles")
      .update({
        telegram_user_id: tg.id,
        telegram_username: tg.username ?? null,
        display_name: tg.first_name,
        email: fakeEmail,
      })
      .eq("id", userId);
  } else {
    // Existing User: telegram_username refreshen
    await service
      .from("profiles")
      .update({
        telegram_user_id: tg.id,
        telegram_username: tg.username ?? null,
      })
      .eq("id", userId);
  }

  // 3) channel_identities upsert + verified_at
  await service
    .from("channel_identities")
    .upsert(
      {
        user_id: userId,
        channel: "telegram",
        external_id: String(tg.id),
        verified_at: new Date().toISOString(),
        opt_in_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        metadata: {
          tg_username: tg.username,
          first_name: tg.first_name,
        },
      },
      { onConflict: "channel,external_id" }
    );

  // 4) Magic-Link generieren + Server-side verifyOtp → Session-Cookie
  if (!userEmail) {
    return json({ error: "missing_email" }, 500);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("[telegram-login] generateLink failed", linkErr);
    return json({ error: "generate_link_failed", detail: linkErr?.message }, 500);
  }
  const hashedToken = linkData.properties.hashed_token;

  // verifyOtp mit dem gerade erzeugten hashed_token → Session wird gesetzt
  const supabase = await createSupabaseServerClient();
  const verifyRes = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (verifyRes.error || !verifyRes.data.user) {
    console.error("[telegram-login] verifyOtp failed", verifyRes.error);
    return json({ error: "session_setup_failed", detail: verifyRes.error?.message }, 500);
  }

  // 5) Anonymous-Session übernehmen (gleiches Pattern wie verify-otp)
  const anonymousId = req.cookies.get(ANONYMOUS_COOKIE_NAME)?.value;
  let migrated: unknown = null;
  if (anonymousId) {
    const { data, error } = await supabase.rpc("migrate_anonymous_to_user", {
      p_anonymous_id: anonymousId,
    });
    if (error) {
      console.error("[telegram-login] migration failed", error);
    } else {
      migrated = data;
    }
  }

  return json({
    ok: true,
    user: { id: userId, telegram_id: tg.id },
    migrated,
    redirect: body.next ?? "/dashboard",
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

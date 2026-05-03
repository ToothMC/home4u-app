import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { getTelegramBot, telegramConfigured } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEEDBACK_TO = "info@home4u.ai";

const BodySchema = z.object({
  message: z.string().trim().min(10).max(4000),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  website: z.string().optional(), // honeypot
});

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const rateBuckets = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = rateBuckets.get(key) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return false;
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return json({ ok: false, error: "invalid_payload", detail: String(err) }, 400);
  }

  // Honeypot: Bot füllt versteckte URL ein → still erfolgreich tun
  if (body.website && body.website.trim().length > 0) {
    console.info("[feedback] honeypot drop");
    return json({ ok: true });
  }

  const user = await getAuthUser();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rateKey = user?.id ?? `ip:${ip}`;
  if (rateLimited(rateKey)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  // Pseudo-Emails von Telegram-Logins (z.B. tg-123@telegram.home4u.local)
  // sind nicht reply-fähig — niemals als ReplyTo verwenden.
  const isReplyable = (e: string | null | undefined): e is string =>
    !!e && !/\.local$/i.test(e) && !/@telegram\./i.test(e);

  const formEmail = body.email && body.email.length > 0 ? body.email : null;
  const replyTo = isReplyable(user?.email)
    ? user!.email!
    : isReplyable(formEmail)
      ? formEmail!
      : undefined;

  // Telegram-Profil laden, falls eingeloggt — als Antwortkanal-Hinweis
  let telegramUserId: string | null = null;
  let telegramUsername: string | null = null;
  if (user?.id) {
    const svc = createSupabaseServiceClient();
    if (svc) {
      const { data } = await svc
        .from("profiles")
        .select("telegram_user_id, telegram_username")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.telegram_user_id != null) telegramUserId = String(data.telegram_user_id);
      if (data?.telegram_username) telegramUsername = data.telegram_username;
    }
  }

  const messageTrimmed = body.message.trim();
  const subject = `[Home4U Feedback] ${messageTrimmed.slice(0, 60)}${
    messageTrimmed.length > 60 ? "…" : ""
  }`;

  const meta: Record<string, string> = {
    "User-ID": user?.id ?? "anon",
    "Auth-Email": user?.email ?? "—",
    "Reply-To": replyTo ?? "— (kein gültiger Mail-Kanal)",
    "Telegram-User-ID": telegramUserId ?? "—",
    "Telegram-Username": telegramUsername ? `@${telegramUsername}` : "—",
    Timestamp: new Date().toISOString(),
    IP: ip,
  };

  const text =
    `${messageTrimmed}\n\n` +
    `— — —\n` +
    Object.entries(meta)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:640px">` +
    `<pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0 0 24px">${escapeHtml(messageTrimmed)}</pre>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">` +
    `<table style="font-size:12px;color:#555;border-collapse:collapse">` +
    Object.entries(meta)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#888">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
      )
      .join("") +
    `</table></div>`;

  const result = await sendEmail({
    to: FEEDBACK_TO,
    subject,
    html,
    text,
    replyTo,
    tags: [
      { name: "type", value: "feedback" },
      { name: "user_id", value: user?.id ?? "anon" },
    ],
  });

  if (!result.ok) {
    console.warn("[feedback] send failed", result);
    // Mail fehlgeschlagen → Telegram trotzdem versuchen, damit nichts verloren geht
  } else {
    console.info(
      `[feedback] sent → ${FEEDBACK_TO} (resend_msg_id=${result.messageId}, user=${user?.id ?? "anon"})`
    );
  }

  // Telegram-Notification an Admin (best-effort, non-blocking für Response)
  await notifyTelegramAdmin({
    message: messageTrimmed,
    meta,
    mailOk: result.ok,
  });

  if (!result.ok) {
    return json(
      { ok: false, error: result.reason, detail: "error" in result ? result.error : undefined },
      result.reason === "not_configured" ? 503 : 502
    );
  }
  return json({ ok: true });
}

async function notifyTelegramAdmin(args: {
  message: string;
  meta: Record<string, string>;
  mailOk: boolean;
}): Promise<void> {
  const adminChatId = process.env.FEEDBACK_TELEGRAM_ADMIN_CHAT_ID;
  const tgConfigured = telegramConfigured();
  console.error(
    `[feedback-tg] adminChatId=${adminChatId ?? "MISSING"} telegramConfigured=${tgConfigured}`
  );
  if (!adminChatId) {
    console.error("[feedback-tg] FEEDBACK_TELEGRAM_ADMIN_CHAT_ID nicht gesetzt — skip");
    return;
  }
  if (!tgConfigured) {
    console.error("[feedback-tg] telegram not configured — skip (missing TELEGRAM_BOT_TOKEN/USERNAME)");
    return;
  }
  try {
    const bot = getTelegramBot();
    const lines = [
      args.mailOk ? "📬 Neues Feedback" : "📬 Neues Feedback (⚠️ Mail fehlgeschlagen)",
      "",
      args.message.length > 1500 ? args.message.slice(0, 1500) + "…" : args.message,
      "",
      "— — —",
      ...Object.entries(args.meta).map(([k, v]) => `${k}: ${v}`),
    ];
    const text = lines.join("\n");
    const result = await bot.api.sendMessage(Number(adminChatId), text);
    console.error(
      `[feedback-tg] sendMessage ok → chat=${adminChatId} msg_id=${result.message_id}`
    );
  } catch (e) {
    console.error(
      `[feedback-tg] sendMessage FAILED → chat=${adminChatId}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

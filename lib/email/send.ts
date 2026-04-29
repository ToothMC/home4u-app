/**
 * Thin Wrapper um Resend für transaktionale E-Mails (Outreach + Notifications).
 *
 * Env:
 *   RESEND_API_KEY       — von resend.com/api-keys
 *   RESEND_FROM_ADDRESS  — verifizierte Domain-Sender, z.B. "Home4U <outreach@home4u.app>"
 *
 * Ohne Env: sendEmail() loggt + returned { ok: false, reason: 'not_configured' } —
 * App crasht nicht, Outreach wird übersprungen (mit outreach_log status='skipped').
 */
import { Resend } from "resend";

let cached: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (cached) return cached;
  cached = new Resend(key);
  return cached;
}

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string };

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY nicht gesetzt — skip send");
    return { ok: false, reason: "not_configured" };
  }
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) {
    console.warn("[email] RESEND_FROM_ADDRESS nicht gesetzt — skip send");
    return { ok: false, reason: "not_configured" };
  }
  try {
    const result = await client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
      tags: params.tags,
    });
    if (result.error) {
      console.error("[email] resend error", result.error);
      return { ok: false, reason: "send_failed", error: String(result.error.message ?? result.error) };
    }
    if (!result.data?.id) {
      return { ok: false, reason: "send_failed", error: "no_message_id" };
    }
    return { ok: true, messageId: result.data.id };
  } catch (e) {
    console.error("[email] send threw", e);
    return {
      ok: false,
      reason: "send_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

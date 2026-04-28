/**
 * Schmaler Resend-REST-Wrapper. Bewusst keine SDK-Dep — der Endpoint ist
 * stabil und ein einfacher fetch-Call reicht für unser Volumen.
 *
 * RESEND_API_KEY muss in der Umgebung gesetzt sein. Ohne Key returned
 * sendEmail({ ok: false, reason: 'no_api_key' }) — der Caller entscheidet
 * dann (Cron loggt + überspringt).
 */

export type SendEmailInput = {
  /** Empfänger-Adresse(n). */
  to: string | string[];
  subject: string;
  /** HTML-Body. Reines Plain-Text wird zusätzlich akzeptiert. */
  html: string;
  /** Optional Plain-Text-Fallback. Resend baut sonst automatisch einen. */
  text?: string;
  /** Override des Default-Absenders. */
  from?: string;
  /** Optionale Reply-To-Adresse. */
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; detail?: string };

const DEFAULT_FROM = "Home4U <hello@home4u.ai>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "no_api_key" };
  }

  const from = input.from ?? process.env.RESEND_FROM ?? DEFAULT_FROM;
  const payload: Record<string, unknown> = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        reason: `http_${res.status}`,
        detail: json.message ?? "",
      };
    }
    if (!json.id) {
      return { ok: false, reason: "no_id_in_response" };
    }
    return { ok: true, id: json.id };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

import { NextRequest } from "next/server";
import {
  verifyActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/listing-action — führt die echte Action aus, NACHDEM der
 * Empfänger auf der Confirmation-Page bestätigt hat.
 *
 * Wird von app/listing-action/page.tsx als Form-Submit aufgerufen.
 * Token kommt als form-data 't', kein Query-Param → bleibt nicht in
 * Browser-History/Server-Logs.
 *
 * Single-use-Schutz: outreach_log.clicked_at wird gecheckt; ist es schon
 * gesetzt, kommt nur die SuccessView zurück (idempotent, aber nicht erneut
 * apply_listing_report).
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const token = formData.get("t");
  if (typeof token !== "string" || !token) {
    return htmlResponse(errorPage("Kein Token übermittelt."), 400);
  }

  let payload: ActionTokenPayload;
  try {
    payload = await verifyActionToken(token);
  } catch (e) {
    console.error("[listing-action POST] token verify failed", e);
    return htmlResponse(
      errorPage("Dieser Link ist ungültig oder abgelaufen."),
      400
    );
  }

  if (payload.action === "reply") {
    return Response.redirect(
      new URL(`/matches/${payload.match_id}`, req.url),
      303
    );
  }

  const reportKind =
    payload.action === "mark_rented"
      ? "rented"
      : payload.action === "still_available"
        ? "still_available"
        : payload.action === "wrong_listing"
          ? "wrong_listing"
          : null;
  if (!reportKind) {
    return htmlResponse(errorPage("Unbekannte Aktion."), 400);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return htmlResponse(errorPage("System nicht erreichbar."), 500);
  }

  // Single-use: wenn der Outreach-Log-Eintrag schon clicked_at hat, nur die
  // SuccessView ohne erneuten RPC-Call.
  const { data: existing } = await service
    .from("outreach_log")
    .select("clicked_at")
    .eq("id", payload.log_id)
    .maybeSingle();
  if (existing?.clicked_at) {
    return htmlResponse(
      successPage(payload.action, "(bereits gemeldet)"),
      200
    );
  }

  const { data, error } = await service.rpc("apply_listing_report", {
    p_listing_id: payload.listing_id,
    p_kind: reportKind,
    p_reporter_role: "broker_link",
    p_match_id: payload.match_id,
    p_reporter_email_hash: payload.recipient_email_hash,
  });

  if (error) {
    console.error("[listing-action POST] apply_listing_report failed", error);
    return htmlResponse(
      errorPage("Konnten Deine Meldung nicht speichern. Versuch es später nochmal."),
      500
    );
  }

  await service.rpc("update_outreach_status", {
    p_log_id: payload.log_id,
    p_status: "clicked",
  });

  // wrong_listing zusätzlich: Listing auf opted_out, damit zukünftiger
  // Crawler-Refresh kein neues Outreach für diesen Empfänger triggert.
  if (reportKind === "wrong_listing") {
    await service
      .from("listings")
      .update({ status: "opted_out", opted_out_at: new Date().toISOString() })
      .eq("id", payload.listing_id);
  }

  const result = data as { ok: boolean; status?: string; error?: string };
  if (!result?.ok) {
    return htmlResponse(
      errorPage(`Fehler: ${result?.error ?? "unbekannt"}`),
      400
    );
  }

  return htmlResponse(successPage(payload.action, result.status ?? "—"), 200);
}

function htmlResponse(html: string, status: number) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function successPage(action: string, newStatus: string): string {
  const headline =
    action === "mark_rented"
      ? "Vielen Dank — wir haben das Inserat als nicht mehr verfügbar markiert."
      : action === "still_available"
        ? "Notiert — das Inserat bleibt aktiv."
        : action === "wrong_listing"
          ? "Notiert — wir senden Dir keine weiteren Anfragen für dieses Inserat."
          : "Erledigt.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Home4U</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;color:#222}.muted{color:#888;font-size:13px}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:12px}</style></head><body><div style="font-size:42px;margin-bottom:12px">✓</div><h1>${escapeHtml(headline)}</h1><p class="muted">Status: <code>${escapeHtml(newStatus)}</code></p><p class="muted" style="margin-top:24px">Falls Du Dich vertan hast, antworte einfach auf die ursprüngliche E-Mail — wir korrigieren das manuell.</p></body></html>`;
}

function errorPage(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Home4U</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;color:#222}</style></head><body><div style="font-size:42px;margin-bottom:12px">⚠️</div><h1>Ups</h1><p>${escapeHtml(msg)}</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

import { redirect } from "next/navigation";
import {
  verifyActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outreach-Action-Endpoint — wird vom Makler über E-Mail-Link aufgerufen.
 *
 * Flow:
 *   1. Token aus Query-Param verifizieren (HMAC, exp ≤ 30d).
 *   2. Action ausführen via apply_listing_report mit broker_link-Rolle.
 *   3. update_outreach_status(clicked) → log_id aus Token.
 *   4. Bestätigungsseite rendern (read-only, kein weiterer State-Change).
 *
 * Kein Login nötig — der Token ist die Autorisierung. Mehrfach-Klick:
 * idempotent (apply_listing_report fügt einen weiteren Audit-Eintrag,
 * Status bleibt aber rented/sold).
 */
export default async function ListingActionPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const params = await searchParams;
  const token = params.t;
  if (!token) {
    return <ErrorView message="Kein Token übergeben." />;
  }

  let payload: ActionTokenPayload;
  try {
    payload = await verifyActionToken(token);
  } catch (e) {
    console.error("[listing-action] token verify failed", e);
    return (
      <ErrorView message="Dieser Link ist ungültig oder abgelaufen. Falls Du das Inserat melden willst, antworte einfach auf die ursprüngliche E-Mail." />
    );
  }

  // Bei reply: einfacher Redirect zum Match — Inseratsinhaber sieht Anfrage.
  if (payload.action === "reply") {
    redirect(`/matches/${payload.match_id}`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return (
      <ErrorView message="System nicht erreichbar. Versuch es später noch einmal." />
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
    return <ErrorView message="Unbekannte Aktion." />;
  }

  const { data, error } = await service.rpc("apply_listing_report", {
    p_listing_id: payload.listing_id,
    p_kind: reportKind,
    p_reporter_role: "broker_link",
    p_match_id: payload.match_id,
    p_reporter_email_hash: payload.recipient_email_hash,
  });

  if (error) {
    console.error("[listing-action] apply_listing_report failed", error);
    return <ErrorView message="Konnten Deine Meldung nicht speichern. Bitte später nochmal versuchen." />;
  }

  // Outreach-Log auf 'clicked' setzen
  await service.rpc("update_outreach_status", {
    p_log_id: payload.log_id,
    p_status: "clicked",
  });

  const result = data as { ok: boolean; status?: string; error?: string };
  if (!result?.ok) {
    return <ErrorView message={`Fehler: ${result?.error ?? "unbekannt"}`} />;
  }

  return <SuccessView action={payload.action} newStatus={result.status} />;
}

function ErrorView({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <div className="mb-4 text-4xl">⚠️</div>
      <h1 className="text-xl font-semibold mb-2">Ups</h1>
      <p className="text-[var(--muted-foreground)]">{message}</p>
    </main>
  );
}

function SuccessView({
  action,
  newStatus,
}: {
  action: string;
  newStatus: string | undefined;
}) {
  const headline =
    action === "mark_rented"
      ? "Vielen Dank — wir haben das Inserat als nicht mehr verfügbar markiert."
      : action === "still_available"
        ? "Notiert — das Inserat bleibt aktiv."
        : action === "wrong_listing"
          ? "Notiert — wir senden Dir keine weiteren Anfragen für dieses Inserat."
          : "Erledigt.";
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <div className="mb-4 text-4xl">✓</div>
      <h1 className="text-xl font-semibold mb-2">{headline}</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Status:{" "}
        <code className="px-1.5 py-0.5 rounded bg-[var(--muted)] text-xs">
          {newStatus ?? "—"}
        </code>
      </p>
      <p className="mt-6 text-xs text-[var(--muted-foreground)]">
        Falls Du Dich vertan hast, antworte einfach auf die ursprüngliche E-Mail
        — wir korrigieren das manuell.
      </p>
    </main>
  );
}

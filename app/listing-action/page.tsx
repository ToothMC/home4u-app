import { redirect } from "next/navigation";
import {
  verifyActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outreach-Action-Confirmation-Page (read-only, NO state-change on GET).
 *
 * Reason: Email-security-scanners (Microsoft Defender, Mimecast, Proofpoint,
 * Google Safe-Browsing) prefetch alle Links in eingehenden Mails. Würde der
 * GET-Handler direkt apply_listing_report aufrufen, würde JEDES Listing
 * sofort auf rented gesetzt durch den Scanner — nicht durch den Empfänger.
 *
 * Daher: GET zeigt nur eine Confirmation-Page mit explizitem Submit-Button.
 * Die echte Aktion läuft dann via POST /api/listing-action über
 * components/ListingActionForm.
 *
 * `reply` ist die einzige Action ohne State-Change → da geht der Redirect
 * direkt durch.
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

  // Reply = read-only Redirect, keine Bestätigung nötig
  if (payload.action === "reply") {
    redirect(`/matches/${payload.match_id}`);
  }

  return <ConfirmationView token={token} action={payload.action} />;
}

function ConfirmationView({ token, action }: { token: string; action: string }) {
  const headline =
    action === "mark_rented"
      ? "Inserat als vermietet/verkauft markieren?"
      : action === "mark_reserved"
        ? "Inserat als „reserviert“ markieren?"
        : action === "still_available"
          ? "Bestätigen: Inserat ist noch verfügbar?"
          : action === "wrong_listing"
            ? "Diese Anfrage gehört nicht zu Dir?"
            : "Aktion bestätigen";
  const body =
    action === "mark_rented"
      ? "Wir setzen das Inserat in Home4U auf „nicht mehr verfügbar“ und schicken Dir keine weiteren Anfragen dafür. Falls der Mietvertrag in den nächsten 7 Tagen nicht zustande kommt und Dein Inserat auf der Original-Plattform aktiv bleibt, reaktivieren wir es automatisch."
      : action === "mark_reserved"
        ? "Wir blenden das Inserat vorübergehend aus den Treffern aus, weil Du eine mündliche Zusage hast. Falls der Mieter abspringt: bei aktivem Original-Inserat reaktivieren wir nach 3 Tagen automatisch — oder Du nimmst das Inserat einfach wieder online."
        : action === "still_available"
          ? "Wir reaktivieren das Inserat in Home4U."
          : action === "wrong_listing"
            ? "Wir markieren das Inserat als „nicht von Dir“ und unterdrücken zukünftige Anfragen."
            : "";

  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold mb-3">{headline}</h1>
      <p className="text-sm text-[var(--muted-foreground)] mb-6">{body}</p>
      <form method="POST" action="/api/listing-action">
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="bg-[var(--primary)] text-[var(--primary-foreground)] px-5 py-2.5 rounded-md font-medium hover:opacity-90"
        >
          Bestätigen
        </button>
      </form>
      <p className="mt-6 text-xs text-[var(--muted-foreground)]">
        Wenn Du das nicht warst — einfach Tab schließen, nichts passiert.
      </p>
    </main>
  );
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

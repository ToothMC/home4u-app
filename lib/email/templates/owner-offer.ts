/**
 * Mail-Template: „Ein Vermieter bietet dir eine Wohnung an".
 *
 * Wird getriggert wenn ein Owner über /gesuche/[id] ein eigenes Listing
 * auf das veröffentlichte Such-Profil des Empfängers anbietet
 * (owner_offer_to_seeker RPC). Die Mail enthält bewusst KEINEN Body-Text
 * des Owners und KEINE Owner-Email — nur Trigger + Listing-Preview + Link
 * ins Home4U-Postfach. Echte Email-Adressen bleiben in beide Richtungen
 * unsichtbar; Antwort läuft ausschließlich über den match-Inbox-Flow.
 */

export type OwnerOfferEmailInput = {
  baseUrl: string;
  matchId: string;
  /** Was der Sucher in seinem Profil hinterlegt hatte — als Reminder. */
  seekerLocation: string;
  seekerType: "rent" | "sale";
  /** Anonymisiertes Listing-Preview (kein Owner-Name). */
  listing: {
    title: string | null;
    city: string | null;
    district: string | null;
    price: number | null;
    currency: string | null;
    rooms: number | null;
    sizeSqm: number | null;
    coverUrl: string | null;
  };
};

export function buildOwnerOfferEmail(input: OwnerOfferEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Neues Wohnungs-Angebot für deine Suche in ${input.seekerLocation}`;
  const inboxUrl = `${input.baseUrl}/dashboard/requests/${input.matchId}`;

  const priceText = formatPrice(input.listing.price, input.listing.currency);
  const locText = [input.listing.district, input.listing.city]
    .filter(Boolean)
    .join(", ");

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:24px auto;padding:0 16px;">
  <h1 style="font-size:20px;margin:0 0 12px 0;">Du hast ein neues Wohnungs-Angebot</h1>
  <p style="font-size:14px;color:#444;margin:0 0 16px 0;">
    Ein Vermieter hat eine Wohnung, die zu deiner Suche
    <strong>${escapeHtml(input.seekerLocation)}</strong>
    (${input.seekerType === "rent" ? "Miete" : "Kauf"}) passen könnte.
  </p>

  <div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin:16px 0;">
    ${
      input.listing.coverUrl
        ? `<img src="${escapeAttr(input.listing.coverUrl)}" alt="" style="width:100%;max-height:240px;object-fit:cover;border-radius:6px;margin-bottom:12px;">`
        : ""
    }
    <div style="font-size:16px;font-weight:600;margin-bottom:4px;">
      ${escapeHtml(input.listing.title ?? "Inserat")}
    </div>
    <div style="font-size:13px;color:#666;">
      ${escapeHtml(locText)}${locText ? " · " : ""}${escapeHtml(priceText)}
      ${input.listing.rooms ? ` · ${input.listing.rooms} Zi` : ""}
      ${input.listing.sizeSqm ? ` · ${input.listing.sizeSqm}m²` : ""}
    </div>
  </div>

  <p style="margin:0 0 16px 0;">
    <a href="${escapeAttr(inboxUrl)}"
       style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">
      Angebot ansehen &amp; antworten
    </a>
  </p>

  <p style="font-size:12px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
    Antworten gehen über das Home4U-Postfach. Deine Email-Adresse ist für
    den Vermieter unsichtbar — und seine für dich. So bleibt der Kontakt
    auf der Plattform und du kannst jederzeit blockieren ohne Email-Spam zu
    befürchten.
  </p>
</body>
</html>`;

  const text = [
    `Du hast ein neues Wohnungs-Angebot für deine Suche in ${input.seekerLocation}.`,
    "",
    `${input.listing.title ?? "Inserat"}`,
    `${locText}${locText ? " · " : ""}${priceText}`,
    input.listing.rooms ? `${input.listing.rooms} Zimmer` : null,
    input.listing.sizeSqm ? `${input.listing.sizeSqm} m²` : null,
    "",
    `Angebot ansehen + antworten: ${inboxUrl}`,
    "",
    "Antworten gehen über das Home4U-Postfach. Email-Adressen bleiben in beide Richtungen unsichtbar.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function formatPrice(price: number | null, currency: string | null): string {
  if (!price || !currency) return "Preis n.A.";
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${price} ${currency}`;
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

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

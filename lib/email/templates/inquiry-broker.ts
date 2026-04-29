/**
 * Mail-Template: „Anfrage für Dein Inserat" an den Inserenten (Bridge oder Direct).
 *
 * Drei Action-Buttons mit signed JWT-Token (alle 30d gültig, single-use idempotent):
 *   - „Reply / Open inquiry"     → öffnet Match-Page (Login-Flow falls nötig)
 *   - „Mark as rented/sold"      → setzt status='rented'/'sold' direkt
 *   - „Not my listing"           → wrong_listing-Audit, dämpft zukünftige Outreach
 *
 * Sprachen: erstmal EN-only. DE/RU/EL kommen wenn das Volumen rechtfertigt.
 *
 * Inhalt: konkret + low-pressure. Wir sind kein Spam, wir leiten eine echte
 * Anfrage weiter — der Empfänger soll genau wissen WARUM die Mail kommt.
 */

export type InquiryBrokerTemplateInput = {
  baseUrl: string;
  listingTitle: string | null;
  listingType: "rent" | "sale";
  listingPrice: number;
  listingCurrency: string;
  listingCity: string | null;
  listingDistrict: string | null;
  listingRooms: number | null;
  listingSizeSqm: number | null;
  listingSourceUrl: string | null;       // Original-Inserat (z.B. Bazaraki-URL)
  seekerNote: string | null;              // Optional: was der Seeker geschrieben hat
  // Tokens — caller signs separately and passes ready-to-use values
  replyToken: string;
  markRentedToken: string;
  wrongListingToken: string;
  language?: "en" | "de" | "ru" | "el";
};

export function buildInquiryBrokerEmail(input: InquiryBrokerTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = input.language ?? "en";
  const t = TEXTS[lang] ?? TEXTS.en;

  const priceFormatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(input.listingPrice);
  const propertyDesc = [
    input.listingRooms != null
      ? input.listingRooms === 0
        ? t.studio
        : `${input.listingRooms} ${t.rooms}`
      : null,
    input.listingSizeSqm ? `${input.listingSizeSqm} m²` : null,
    [input.listingDistrict, input.listingCity].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  const priceLine = `${priceFormatted} ${input.listingCurrency}${input.listingType === "rent" ? "/mo" : ""}`;
  const titleLine = input.listingTitle || propertyDesc || t.your_listing;

  const replyUrl = `${input.baseUrl}/listing-action?t=${encodeURIComponent(input.replyToken)}`;
  const rentedUrl = `${input.baseUrl}/listing-action?t=${encodeURIComponent(input.markRentedToken)}`;
  const wrongUrl = `${input.baseUrl}/listing-action?t=${encodeURIComponent(input.wrongListingToken)}`;

  const noteBlock = input.seekerNote?.trim()
    ? `<blockquote style="border-left:3px solid #ddd;margin:12px 0;padding:8px 12px;color:#444;font-style:italic;">${escapeHtml(input.seekerNote)}</blockquote>`
    : "";

  const sourceLine = input.listingSourceUrl
    ? `<p style="font-size:12px;color:#888;">${t.from_listing}: <a href="${input.listingSourceUrl}" style="color:#888;">${input.listingSourceUrl}</a></p>`
    : "";

  const subject = `${t.headline}: ${titleLine}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 16px;">${t.headline}</h2>
  <p>${t.intro_line.replace("{title}", `<strong>${escapeHtml(titleLine)}</strong>`).replace("{price}", `<strong>${priceLine}</strong>`)}</p>
  ${noteBlock}
  <div style="margin:24px 0;display:flex;gap:8px;flex-wrap:wrap;">
    <a href="${replyUrl}" style="background:#0a66c2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">${t.btn_reply}</a>
    <a href="${rentedUrl}" style="background:#fff;border:1px solid #999;color:#444;padding:10px 16px;border-radius:6px;text-decoration:none;">${input.listingType === "rent" ? t.btn_rented : t.btn_sold}</a>
    <a href="${wrongUrl}" style="background:#fff;border:1px solid #ccc;color:#888;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;">${t.btn_wrong}</a>
  </div>
  <p style="font-size:12px;color:#888;">${t.footer_what}</p>
  ${sourceLine}
  <p style="font-size:11px;color:#aaa;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">${t.legal}</p>
</body></html>`;

  const text = `${t.headline}

${t.intro_line.replace("{title}", titleLine).replace("{price}", priceLine)}
${input.seekerNote ? `\n"${input.seekerNote}"\n` : ""}
${t.btn_reply}: ${replyUrl}
${input.listingType === "rent" ? t.btn_rented : t.btn_sold}: ${rentedUrl}
${t.btn_wrong}: ${wrongUrl}

${t.footer_what}
${input.listingSourceUrl ? `\n${t.from_listing}: ${input.listingSourceUrl}` : ""}

—
${t.legal}`;

  return { subject, html, text };
}

const TEXTS = {
  en: {
    headline: "New inquiry from Home4U",
    intro_line:
      'A user on Home4U is interested in your listing {title} ({price}) and asks if it is still available.',
    studio: "Studio",
    rooms: "BR",
    your_listing: "your listing",
    from_listing: "Original",
    btn_reply: "Reply / Open inquiry",
    btn_rented: "Already rented",
    btn_sold: "Already sold",
    btn_wrong: "Not my listing",
    footer_what:
      "Home4U aggregates publicly available property listings from Cyprus and forwards real inquiries from house seekers to the original publisher. We never share your contact details.",
    legal:
      "If you don't want to receive further inquiries for this listing, click „Not my listing“. Lawful basis: Art. 6(1)(f) GDPR — legitimate interest in forwarding a concrete user inquiry.",
  },
  de: {
    headline: "Neue Anfrage von Home4U",
    intro_line:
      'Ein Wohnungssuchender auf Home4U interessiert sich für Dein Inserat {title} ({price}) und fragt ob es noch verfügbar ist.',
    studio: "Studio",
    rooms: "Zi",
    your_listing: "Dein Inserat",
    from_listing: "Original",
    btn_reply: "Antworten",
    btn_rented: "Schon vermietet",
    btn_sold: "Schon verkauft",
    btn_wrong: "Gehört nicht zu mir",
    footer_what:
      "Home4U bündelt öffentliche Immobilien-Inserate aus Zypern und leitet echte Anfragen an den Inserenten weiter. Wir geben Deine Kontaktdaten nie weiter.",
    legal:
      "Falls Du keine weiteren Anfragen für dieses Inserat möchtest, klicke „Gehört nicht zu mir“. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Weiterleitung einer konkreten Nutzeranfrage.",
  },
  ru: {
    headline: "Новый запрос с Home4U",
    intro_line:
      'Пользователь Home4U заинтересован в Вашем объявлении {title} ({price}) и спрашивает, доступно ли оно ещё.',
    studio: "Студия",
    rooms: "комн.",
    your_listing: "Ваше объявление",
    from_listing: "Оригинал",
    btn_reply: "Ответить",
    btn_rented: "Уже сдано",
    btn_sold: "Уже продано",
    btn_wrong: "Не моё объявление",
    footer_what:
      "Home4U собирает открытые объявления о недвижимости на Кипре и пересылает реальные запросы автору. Ваши контакты не передаются.",
    legal:
      "Если не хотите получать дальнейшие запросы по этому объявлению, нажмите „Не моё объявление“. Правовая основа: ст. 6(1)(f) GDPR.",
  },
  el: {
    headline: "Νέο αίτημα από Home4U",
    intro_line:
      'Ένας χρήστης του Home4U ενδιαφέρεται για το αγγελία σας {title} ({price}) και ρωτά αν είναι ακόμη διαθέσιμη.',
    studio: "Studio",
    rooms: "δωμ.",
    your_listing: "η αγγελία σας",
    from_listing: "Πηγή",
    btn_reply: "Απάντηση",
    btn_rented: "Ήδη ενοικιάστηκε",
    btn_sold: "Ήδη πουλήθηκε",
    btn_wrong: "Δεν είναι δική μου",
    footer_what:
      "Το Home4U συγκεντρώνει δημόσιες αγγελίες ακινήτων στην Κύπρο και προωθεί πραγματικά αιτήματα στον αρχικό αγγελιοδότη. Δεν μοιραζόμαστε τα στοιχεία επικοινωνίας σας.",
    legal:
      "Αν δεν θέλετε άλλα αιτήματα για αυτή την αγγελία, πατήστε „Δεν είναι δική μου“. Νομική βάση: Άρθρο 6(1)(στ) GDPR.",
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

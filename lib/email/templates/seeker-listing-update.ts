/**
 * Mail-Template: „Dein angefragtes Inserat ist nicht mehr verfügbar".
 * Wird an den Seeker geschickt, wenn der Inserent via Action-Link
 * ein Listing als rented/sold markiert hat.
 *
 * Kein Action-Button — rein informativ. Link zurück ins Dashboard.
 */

export type SeekerListingUpdateInput = {
  baseUrl: string;
  listingTitle: string | null;
  listingType: "rent" | "sale";
  listingCity: string | null;
  newStatus: "rented" | "sold" | "stale";
  language?: "en" | "de" | "ru" | "el";
};

export function buildSeekerListingUpdateEmail(input: SeekerListingUpdateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = input.language ?? "de";
  const t = TEXTS[lang] ?? TEXTS.de;
  const titleLine =
    input.listingTitle?.trim() ||
    [input.listingCity, input.listingType === "rent" ? t.rent : t.sale]
      .filter(Boolean)
      .join(" · ");

  const headline =
    input.newStatus === "rented"
      ? t.headline_rented
      : input.newStatus === "sold"
        ? t.headline_sold
        : t.headline_stale;

  const dashboardUrl = `${input.baseUrl}/dashboard`;

  const subject = `${headline}: ${titleLine}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 16px;">${escapeHtml(headline)}</h2>
  <p>${t.body_line.replace("{title}", `<strong>${escapeHtml(titleLine)}</strong>`)}</p>
  <p style="margin-top:24px;">
    <a href="${dashboardUrl}" style="background:#0a66c2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">${t.cta}</a>
  </p>
  <p style="font-size:12px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">${t.footer}</p>
</body></html>`;

  const text = `${headline}

${t.body_line.replace("{title}", titleLine)}

${t.cta}: ${dashboardUrl}

—
${t.footer}`;

  return { subject, html, text };
}

const TEXTS = {
  de: {
    headline_rented: "Inserat ist nicht mehr verfügbar",
    headline_sold: "Inserat ist nicht mehr verfügbar",
    headline_stale: "Verfügbarkeit unklar",
    body_line:
      "Schade — das von Dir angefragte Inserat {title} wurde gerade vom Inserenten als nicht mehr verfügbar markiert. Auf Home4U findest Du weitere passende Angebote.",
    cta: "Weitere Treffer im Dashboard",
    rent: "Mietangebot",
    sale: "Verkaufsangebot",
    footer:
      "Du bekommst diese Mail, weil Du eine Anfrage zu diesem Inserat über Home4U gesendet hast.",
  },
  en: {
    headline_rented: "Listing no longer available",
    headline_sold: "Listing no longer available",
    headline_stale: "Availability uncertain",
    body_line:
      "The listing you inquired about ({title}) was just marked as no longer available by the publisher. Find more matches on Home4U.",
    cta: "More matches in your dashboard",
    rent: "Rental",
    sale: "Sale",
    footer:
      "You're receiving this because you sent an inquiry about this listing on Home4U.",
  },
  ru: {
    headline_rented: "Объявление больше не доступно",
    headline_sold: "Объявление больше не доступно",
    headline_stale: "Доступность неясна",
    body_line:
      "Объявление, которым Вы интересовались ({title}), отмечено как больше не доступное.",
    cta: "Другие предложения",
    rent: "Аренда",
    sale: "Продажа",
    footer: "Вы получаете это письмо, так как сделали запрос через Home4U.",
  },
  el: {
    headline_rented: "Η αγγελία δεν είναι πλέον διαθέσιμη",
    headline_sold: "Η αγγελία δεν είναι πλέον διαθέσιμη",
    headline_stale: "Η διαθεσιμότητα είναι αβέβαιη",
    body_line:
      "Η αγγελία που σας ενδιέφερε ({title}) σημειώθηκε ως μη διαθέσιμη.",
    cta: "Περισσότερες προτάσεις",
    rent: "Ενοικίαση",
    sale: "Πώληση",
    footer: "Λαμβάνετε αυτό το μήνυμα επειδή στείλατε αίτημα μέσω Home4U.",
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

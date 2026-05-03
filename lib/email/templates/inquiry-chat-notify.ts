/**
 * Info-Mail-Template: "Neue Anfrage zu deinem Inserat".
 *
 * Reines Notification-Template — KEIN Reply-Pfad, KEINE Action-Buttons.
 * Wird für Plattform-Inserate (`source='direct'`) verwendet, wo der
 * Reply ausschließlich über den In-App-Chat stattfindet.
 *
 * Mehrsprachig (de/en/ru/el).
 */

export type InquiryChatNotifyInput = {
  chatUrl: string; // Direkt-Link zum Chat-Fenster (kein Token-Tinkering — Auth-Wall greift)
  listingTitle: string | null;
  listingCity: string | null;
  listingDistrict: string | null;
  listingPrice: number;
  listingCurrency: string;
  listingType: "rent" | "sale";
  language?: "en" | "de" | "ru" | "el";
};

export function buildInquiryChatNotifyEmail(input: InquiryChatNotifyInput): {
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
  const priceLine = `${priceFormatted} ${input.listingCurrency}${input.listingType === "rent" ? "/mo" : ""}`;
  const locationLine = [input.listingDistrict, input.listingCity].filter(Boolean).join(", ");
  const titleLine = input.listingTitle || locationLine || t.your_listing;

  const subject = t.subject;

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:540px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(t.heading)}</h1>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${escapeHtml(t.intro)}</p>
  <div style="background:#f5f5f5;border-radius:8px;padding:12px 16px;margin:0 0 20px;">
    <div style="font-weight:600;font-size:14px;">${escapeHtml(titleLine)}</div>
    ${locationLine ? `<div style="color:#555;font-size:13px;margin-top:2px;">${escapeHtml(locationLine)}</div>` : ""}
    <div style="color:#555;font-size:13px;margin-top:2px;">${escapeHtml(priceLine)}</div>
  </div>
  <p style="margin:0 0 20px;font-size:14px;">${escapeHtml(t.cta_text)}</p>
  <a href="${input.chatUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(t.cta_button)}</a>
  <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.5;">${escapeHtml(t.footnote)}</p>
</body></html>`;

  const text = [
    t.heading,
    "",
    t.intro,
    "",
    titleLine,
    locationLine,
    priceLine,
    "",
    t.cta_text,
    input.chatUrl,
    "",
    t.footnote,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TEXTS: Record<"en" | "de" | "ru" | "el", {
  subject: string;
  heading: string;
  intro: string;
  cta_text: string;
  cta_button: string;
  footnote: string;
  your_listing: string;
}> = {
  en: {
    subject: "New inquiry for your listing",
    heading: "You have a new inquiry",
    intro: "Someone is interested in your property and started a chat with you.",
    cta_text: "Open the chat to reply:",
    cta_button: "Open chat",
    footnote: "Replies happen only inside the chat — please do not reply to this email.",
    your_listing: "your listing",
  },
  de: {
    subject: "Neue Anfrage für dein Inserat",
    heading: "Du hast eine neue Anfrage",
    intro: "Jemand interessiert sich für dein Inserat und hat einen Chat mit dir gestartet.",
    cta_text: "Öffne den Chat, um zu antworten:",
    cta_button: "Chat öffnen",
    footnote: "Antworten laufen ausschließlich im Chat — bitte antworte nicht auf diese E-Mail.",
    your_listing: "dein Inserat",
  },
  ru: {
    subject: "Новый запрос по вашему объявлению",
    heading: "У вас новый запрос",
    intro: "Кто-то заинтересовался вашим объявлением и открыл с вами чат.",
    cta_text: "Откройте чат, чтобы ответить:",
    cta_button: "Открыть чат",
    footnote: "Ответы возможны только внутри чата — пожалуйста, не отвечайте на это письмо.",
    your_listing: "вашему объявлению",
  },
  el: {
    subject: "Νέο αίτημα για την αγγελία σας",
    heading: "Έχετε ένα νέο αίτημα",
    intro: "Κάποιος ενδιαφέρεται για την αγγελία σας και ξεκίνησε συνομιλία.",
    cta_text: "Ανοίξτε τη συνομιλία για να απαντήσετε:",
    cta_button: "Άνοιγμα συνομιλίας",
    footnote: "Οι απαντήσεις γίνονται μόνο μέσα στη συνομιλία — μην απαντάτε σε αυτό το μήνυμα.",
    your_listing: "την αγγελία σας",
  },
};

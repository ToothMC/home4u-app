/**
 * Mail-Template: „Neue Treffer für Deine Suche".
 * Wird vom notify-new-matches-Cron an eingeloggte User geschickt, deren
 * search_profiles.notify_new_matches = true und seit last_notified_at
 * mindestens ein neues Match aufgetaucht ist.
 */

export type NewMatchItem = {
  id: string;
  title: string | null;
  type: "rent" | "sale";
  price: number | null;
  currency: string | null;
  city: string | null;
  district: string | null;
  rooms: number | null;
  sizeSqm: number | null;
  coverUrl: string | null;
};

export type NewMatchesEmailInput = {
  baseUrl: string;
  searchLocation: string;
  searchType: "rent" | "sale";
  matches: NewMatchItem[];
  language?: "en" | "de" | "ru" | "el";
};

export function buildNewMatchesEmail(input: NewMatchesEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = input.language ?? "de";
  const t = TEXTS[lang] ?? TEXTS.de;
  const count = input.matches.length;
  const headline = (count === 1 ? t.headline_one : t.headline_many).replace(
    "{count}",
    String(count)
  );
  const subject = `${headline} – ${input.searchLocation}`;
  const dashboardUrl = `${input.baseUrl}/dashboard`;

  const itemsHtml = input.matches
    .map((m) => renderItemHtml(m, input.baseUrl, t))
    .join("");
  const itemsText = input.matches
    .map((m) => renderItemText(m, input.baseUrl, t))
    .join("\n\n");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#222;background:#fafafa;">
  <h2 style="margin:0 0 8px;">${escapeHtml(headline)}</h2>
  <p style="margin:0 0 24px;color:#555;">${escapeHtml(t.intro.replace("{location}", input.searchLocation))}</p>
  ${itemsHtml}
  <p style="margin-top:32px;">
    <a href="${dashboardUrl}" style="background:#0a66c2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">${t.cta_dashboard}</a>
  </p>
  <p style="font-size:12px;color:#888;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
    ${escapeHtml(t.footer)}<br/>
    <a href="${dashboardUrl}/profile" style="color:#0a66c2;text-decoration:underline;">${escapeHtml(t.unsubscribe)}</a>
  </p>
</body></html>`;

  const text = `${headline}

${t.intro.replace("{location}", input.searchLocation)}

${itemsText}

${t.cta_dashboard}: ${dashboardUrl}

—
${t.footer}
${t.unsubscribe}: ${dashboardUrl}/profile`;

  return { subject, html, text };
}

function renderItemHtml(
  m: NewMatchItem,
  baseUrl: string,
  t: (typeof TEXTS)[keyof typeof TEXTS]
): string {
  const url = `${baseUrl}/listings/${m.id}`;
  const titleLine =
    m.title?.trim() ||
    [m.city, m.type === "rent" ? t.rent : t.sale].filter(Boolean).join(" · ");
  const meta = [
    m.rooms != null ? `${m.rooms} ${t.rooms_unit}` : null,
    m.sizeSqm != null ? `${m.sizeSqm} m²` : null,
    [m.district, m.city].filter(Boolean).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const priceLine =
    m.price != null
      ? `${formatPrice(m.price)} ${m.currency ?? "EUR"}${m.type === "rent" ? ` / ${t.month}` : ""}`
      : "";

  const cover = m.coverUrl
    ? `<a href="${url}" style="display:block;"><img src="${escapeAttr(m.coverUrl)}" alt="" style="display:block;width:100%;max-width:592px;height:auto;border-radius:8px 8px 0 0;"/></a>`
    : "";

  return `<div style="background:#fff;border:1px solid #eee;border-radius:8px;margin-bottom:16px;overflow:hidden;">
  ${cover}
  <div style="padding:14px 16px;">
    <a href="${url}" style="color:#111;text-decoration:none;"><strong style="font-size:16px;">${escapeHtml(titleLine)}</strong></a>
    ${meta ? `<div style="color:#666;font-size:13px;margin-top:4px;">${escapeHtml(meta)}</div>` : ""}
    ${priceLine ? `<div style="color:#0a66c2;font-weight:600;margin-top:8px;">${escapeHtml(priceLine)}</div>` : ""}
  </div>
</div>`;
}

function renderItemText(
  m: NewMatchItem,
  baseUrl: string,
  t: (typeof TEXTS)[keyof typeof TEXTS]
): string {
  const url = `${baseUrl}/listings/${m.id}`;
  const titleLine =
    m.title?.trim() ||
    [m.city, m.type === "rent" ? t.rent : t.sale].filter(Boolean).join(" · ");
  const priceLine =
    m.price != null
      ? `${formatPrice(m.price)} ${m.currency ?? "EUR"}${m.type === "rent" ? ` / ${t.month}` : ""}`
      : "";
  const meta = [
    m.rooms != null ? `${m.rooms} ${t.rooms_unit}` : null,
    m.sizeSqm != null ? `${m.sizeSqm} m²` : null,
    [m.district, m.city].filter(Boolean).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `• ${titleLine}\n  ${[meta, priceLine].filter(Boolean).join(" — ")}\n  ${url}`;
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n);
}

const TEXTS = {
  de: {
    headline_one: "1 neuer Treffer für Deine Suche",
    headline_many: "{count} neue Treffer für Deine Suche",
    intro: "Seit Deiner letzten Mail sind passende Inserate in {location} dazugekommen:",
    cta_dashboard: "Alle Treffer im Dashboard",
    rent: "Mietangebot",
    sale: "Verkaufsangebot",
    rooms_unit: "Zi.",
    month: "Monat",
    footer:
      "Du bekommst diese Mail, weil Du eine aktive Suche auf Home4U hast und Benachrichtigungen aktiviert sind.",
    unsubscribe: "Unsubscribe – Home4U Suchergebnisse",
  },
  en: {
    headline_one: "1 new match for your search",
    headline_many: "{count} new matches for your search",
    intro: "New listings in {location} since your last email:",
    cta_dashboard: "View all matches",
    rent: "Rental",
    sale: "Sale",
    rooms_unit: "rooms",
    month: "month",
    footer:
      "You're getting this email because you have an active search on Home4U with notifications enabled.",
    unsubscribe: "Unsubscribe – Home4U search results",
  },
  ru: {
    headline_one: "1 новое совпадение по вашему поиску",
    headline_many: "{count} новых совпадений по вашему поиску",
    intro: "Новые объявления в {location} с момента последнего письма:",
    cta_dashboard: "Все совпадения в личном кабинете",
    rent: "Аренда",
    sale: "Продажа",
    rooms_unit: "комн.",
    month: "мес.",
    footer:
      "Вы получаете это письмо, потому что у вас активный поиск на Home4U с включёнными уведомлениями.",
    unsubscribe: "Unsubscribe – результаты поиска Home4U",
  },
  el: {
    headline_one: "1 νέα αντιστοιχία για την αναζήτησή σας",
    headline_many: "{count} νέες αντιστοιχίες για την αναζήτησή σας",
    intro: "Νέες αγγελίες στην περιοχή {location} από το τελευταίο email:",
    cta_dashboard: "Όλες οι αντιστοιχίες",
    rent: "Ενοικίαση",
    sale: "Πώληση",
    rooms_unit: "δωμ.",
    month: "μήνα",
    footer:
      "Λαμβάνετε αυτό το email επειδή έχετε ενεργή αναζήτηση στο Home4U με ενεργοποιημένες ειδοποιήσεις.",
    unsubscribe: "Unsubscribe – αποτελέσματα αναζήτησης Home4U",
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

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

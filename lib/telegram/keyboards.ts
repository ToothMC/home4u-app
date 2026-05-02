/**
 * Inline-Keyboard-Builder für Telegram.
 *
 * Match-Karten und Quick-Replies sollen kanal-agnostisch sein: Sophie liefert
 * abstrakte Button-Definitionen, der Telegram-Adapter rendert sie als
 * InlineKeyboardMarkup, der Web-Adapter könnte sie später als HTML-Buttons
 * rendern.
 */
import type { InlineKeyboardMarkup } from "grammy/types";
import { TG_BUTTON } from "@/lib/telegram/i18n";
import type { Lang } from "@/lib/translation/glossary";

type Locale = Lang | string | null | undefined;

export type AbstractButton =
  | { kind: "callback"; label: string; action: string; payload?: string }
  | { kind: "url"; label: string; url: string };

/**
 * Rendert ein Array von Buttons in ein 2-pro-Zeile InlineKeyboard.
 */
export function renderKeyboard(buttons: AbstractButton[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map(toTelegramButton);
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function toTelegramButton(b: AbstractButton) {
  if (b.kind === "url") {
    return { text: b.label, url: b.url };
  }
  // callback_data hat 64-Byte-Limit von Telegram
  const payload = b.payload ? `${b.action}:${b.payload}` : b.action;
  if (Buffer.byteLength(payload, "utf8") > 64) {
    throw new Error(
      `callback_data exceeds 64 bytes: ${payload.slice(0, 80)}...`
    );
  }
  return { text: b.label, callback_data: payload };
}

/**
 * Standard-Keyboard für eine Match-Karte.
 *  - Details / Bilder als callback_data (Bot lädt Listing-Details / sendet MediaGroup)
 *  - Anfragen als callback_data (triggert confirm_match_request Tool)
 *  - "Im Web öffnen" als URL (Deeplink-to-Web)
 */
export function matchCardKeyboard(args: {
  matchId: string;
  listingId: string;
  webUrl: string;
  locale?: Locale;
}): InlineKeyboardMarkup {
  return renderKeyboard([
    { kind: "callback", label: TG_BUTTON.details(args.locale), action: "match_details", payload: args.matchId },
    { kind: "callback", label: TG_BUTTON.photos(args.locale), action: "match_photos", payload: args.matchId },
    { kind: "callback", label: TG_BUTTON.inquire(args.locale), action: "match_inquire", payload: args.matchId },
    { kind: "url", label: TG_BUTTON.openInWeb(args.locale), url: args.webUrl },
  ]);
}

/**
 * Bridge-Outreach an Owner: Lead ansehen / Nicht interessiert.
 */
export function bridgeOutreachKeyboard(args: {
  matchId: string;
  webUrl: string;
  locale?: Locale;
}): InlineKeyboardMarkup {
  return renderKeyboard([
    { kind: "url", label: TG_BUTTON.viewLead(args.locale), url: args.webUrl },
    { kind: "callback", label: TG_BUTTON.notInterested(args.locale), action: "bridge_decline", payload: args.matchId },
  ]);
}

/**
 * Sprach-Picker-Keyboard für /language-Command.
 */
export function languagePickerKeyboard(): InlineKeyboardMarkup {
  return renderKeyboard([
    { kind: "callback", label: "🇬🇧 English", action: "set_lang", payload: "en" },
    { kind: "callback", label: "🇩🇪 Deutsch", action: "set_lang", payload: "de" },
    { kind: "callback", label: "🇷🇺 Русский", action: "set_lang", payload: "ru" },
    { kind: "callback", label: "🇨🇾 Ελληνικά", action: "set_lang", payload: "el" },
  ]);
}

/**
 * Parst eine callback_data zurück in {action, payload}.
 */
export function parseCallbackData(data: string): {
  action: string;
  payload: string | null;
} {
  const idx = data.indexOf(":");
  if (idx < 0) return { action: data, payload: null };
  return { action: data.slice(0, idx), payload: data.slice(idx + 1) };
}

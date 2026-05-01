/**
 * Telegram-Bot-spezifische i18n-Strings (Buttons, Commands, kurze Hinweise).
 * Sophie-Antworten selbst werden vom Modell in der User-Sprache erzeugt; hier
 * nur die Strings, die NICHT durchs LLM laufen (Disclaimer, /stop-Bestätigung,
 * Standard-Buttons).
 *
 * Sprachen: DE/EN/RU/EL — Fallback auf EN.
 */
import type { Lang } from "@/lib/translation/glossary";

type Locale = Lang | string | null | undefined;

function pick<T extends Record<Lang, string>>(map: T, locale: Locale): string {
  if (typeof locale === "string") {
    const short = locale.slice(0, 2).toLowerCase();
    if (short === "de" || short === "en" || short === "ru" || short === "el") {
      return map[short];
    }
  }
  return map.en;
}

export const TG_TEXT = {
  aiDisclaimer: (locale: Locale) =>
    pick(
      {
        de: "Ich bin Sophie, die KI-Assistentin von Home4U.",
        en: "I'm Sophie, the AI assistant from Home4U.",
        ru: "Я Sophie, AI-ассистент Home4U.",
        el: "Είμαι η Sophie, η ΑΙ βοηθός της Home4U.",
      },
      locale
    ),

  stopConfirmed: (locale: Locale) =>
    pick(
      {
        de: "Verstanden — du bekommst keine weiteren Nachrichten von mir. Schreib /start, wenn du wieder loslegen willst.",
        en: "Got it — you won't get more messages from me. Send /start whenever you want to come back.",
        ru: "Понял — больше сообщений от меня не будет. Отправь /start, когда захочешь вернуться.",
        el: "Κατανοητό — δεν θα λάβεις άλλα μηνύματα. Στείλε /start όταν θες να επιστρέψεις.",
      },
      locale
    ),

  reactivated: (locale: Locale) =>
    pick(
      {
        de: "Willkommen zurück. Worum geht's heute — suchst du oder vermietest du?",
        en: "Welcome back. What's up today — searching or listing?",
        ru: "С возвращением. Чем занимаемся сегодня — ищем или сдаём?",
        el: "Καλώς όρισες πάλι. Σήμερα — ψάχνεις ή νοικιάζεις;",
      },
      locale
    ),

  languageSet: (locale: Locale) =>
    pick(
      {
        de: "Sprache aktualisiert.",
        en: "Language updated.",
        ru: "Язык обновлён.",
        el: "Η γλώσσα ενημερώθηκε.",
      },
      locale
    ),

  optedOut: (locale: Locale) =>
    pick(
      {
        de: "Du hast vorher /stop geschickt — schreib /start, um wieder zu starten.",
        en: "You sent /stop earlier — send /start to resume.",
        ru: "Раньше вы отправили /stop — пришлите /start, чтобы продолжить.",
        el: "Είχες στείλει /stop — στείλε /start για να ξεκινήσεις πάλι.",
      },
      locale
    ),

  errorGeneric: (locale: Locale) =>
    pick(
      {
        de: "Hmm, da ging gerade was schief. Probier's nochmal in einer Minute.",
        en: "Hmm, something went wrong. Try again in a minute.",
        ru: "Хм, что-то пошло не так. Попробуй через минуту.",
        el: "Κάτι πήγε στραβά. Δοκίμασε ξανά σε ένα λεπτό.",
      },
      locale
    ),
} as const;

/**
 * Standard-Inline-Button-Labels (für Match-Karten und Quick-Replies).
 */
export const TG_BUTTON = {
  details: (locale: Locale) =>
    pick({ de: "Details", en: "Details", ru: "Детали", el: "Λεπτομέρειες" }, locale),

  photos: (locale: Locale) =>
    pick({ de: "Bilder", en: "Photos", ru: "Фото", el: "Φωτογραφίες" }, locale),

  inquire: (locale: Locale) =>
    pick({ de: "Anfragen", en: "Inquire", ru: "Запросить", el: "Ενδιαφέρομαι" }, locale),

  hide: (locale: Locale) =>
    pick({ de: "Verbergen", en: "Hide", ru: "Скрыть", el: "Απόκρυψη" }, locale),

  viewLead: (locale: Locale) =>
    pick({ de: "Lead ansehen", en: "View lead", ru: "Посмотреть лид", el: "Δες τον ενδιαφερόμενο" }, locale),

  notInterested: (locale: Locale) =>
    pick(
      {
        de: "Nicht interessiert",
        en: "Not interested",
        ru: "Не интересно",
        el: "Δεν με ενδιαφέρει",
      },
      locale
    ),

  openInWeb: (locale: Locale) =>
    pick(
      {
        de: "Im Web öffnen",
        en: "Open in web",
        ru: "Открыть в вебе",
        el: "Άνοιξε στο web",
      },
      locale
    ),
} as const;

/**
 * Bot-Command-Beschreibungen für /setcommands an BotFather.
 */
export const TG_COMMANDS_PER_LANG: Record<Lang, Array<{ command: string; description: string }>> = {
  en: [
    { command: "start", description: "Start a conversation with Sophie" },
    { command: "matches", description: "Show your current matches" },
    { command: "language", description: "Change response language" },
    { command: "stop", description: "Stop messages from Sophie" },
    { command: "help", description: "Help and commands" },
  ],
  de: [
    { command: "start", description: "Konversation mit Sophie starten" },
    { command: "matches", description: "Aktuelle Treffer anzeigen" },
    { command: "language", description: "Antwort-Sprache wechseln" },
    { command: "stop", description: "Nachrichten von Sophie stoppen" },
    { command: "help", description: "Hilfe und Befehle" },
  ],
  ru: [
    { command: "start", description: "Начать разговор с Sophie" },
    { command: "matches", description: "Показать текущие совпадения" },
    { command: "language", description: "Сменить язык ответов" },
    { command: "stop", description: "Остановить сообщения от Sophie" },
    { command: "help", description: "Справка и команды" },
  ],
  el: [
    { command: "start", description: "Ξεκίνα συνομιλία με τη Sophie" },
    { command: "matches", description: "Δες τα τρέχοντα ταιριάσματα" },
    { command: "language", description: "Άλλαξε γλώσσα απάντησης" },
    { command: "stop", description: "Σταμάτα τα μηνύματα από τη Sophie" },
    { command: "help", description: "Βοήθεια και εντολές" },
  ],
};

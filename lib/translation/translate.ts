/**
 * Auto-Übersetzung via Claude Haiku 4.5 mit Domain-Glossar + Cache.
 *
 * Nutzungsbeispiel:
 *   const out = await translate({
 *     text: "Suche 2-Zimmer-Wohnung in Limassol, Budget 1500.",
 *     source_lang: "de",
 *     target_langs: ["ru", "en"],
 *     context: "chat",
 *   });
 *   // out.translations.ru === "Ищу 2-комнатную квартиру в Лимасоле, бюджет 1500."
 *
 * Cache: identische (source_lang|text)-Hashes werden in translation_cache
 * gespeichert. Eine zweite Anfrage mit demselben Input macht keinen API-Call.
 *
 * Auto-Detect: wenn source_lang='auto', wird Haiku zuerst zur Detection
 * genutzt (gleicher Call kann das in einem Schritt machen).
 *
 * Best-Effort: Bei API-Fehlern wird das Original zurückgegeben mit
 * `error`-Feld — UI zeigt dann „Übersetzung gerade nicht verfügbar".
 */
import { createHash } from "node:crypto";
import { getAnthropic, MODEL_HAIKU } from "@/lib/anthropic";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { renderGlossaryForPrompt, type Lang } from "@/lib/translation/glossary";

export type TranslationContext = "chat" | "listing" | "email" | "system";

export type TranslateInput = {
  text: string;
  source_lang: Lang | "auto";
  target_langs: Lang[];
  context?: TranslationContext;
};

export type TranslateOutput = {
  /** Erkannte oder übergebene Quell-Sprache */
  source_lang: Lang;
  /** Map mit Übersetzungen pro target_lang. Source-Lang nicht enthalten. */
  translations: Partial<Record<Lang, string>>;
  /** Setzt sich wenn API-Call fehlschlug — Caller fällt auf Original zurück. */
  error?: string;
};

const ALLOWED_LANGS: readonly Lang[] = ["de", "en", "ru", "el"] as const;

function isLang(s: string): s is Lang {
  return ALLOWED_LANGS.includes(s as Lang);
}

function hashSource(sourceLang: string, text: string): string {
  return createHash("sha256")
    .update(`${sourceLang}|${text}`)
    .digest("hex");
}

/**
 * Hauptfunktion. Bei Cache-Hit kein API-Call.
 */
export async function translate(input: TranslateInput): Promise<TranslateOutput> {
  const text = input.text.trim();
  if (!text) {
    return { source_lang: "en", translations: {} };
  }

  // Wenn keine Targets oder source explizit gleich allen targets → no-op
  const targets = input.target_langs
    .filter(isLang)
    .filter((t) => t !== input.source_lang) as Lang[];
  if (targets.length === 0) {
    return {
      source_lang: input.source_lang === "auto" ? "en" : input.source_lang,
      translations: {},
    };
  }

  const supabase = createSupabaseServiceClient();
  const context = input.context ?? "chat";

  // Cache-Lookup nur möglich wenn source_lang bekannt — bei 'auto' machen wir
  // erst den API-Call, danach cachen wir das Ergebnis mit erkannter Sprache.
  let detectedSource: Lang | null =
    input.source_lang !== "auto" ? input.source_lang : null;
  const translations: Partial<Record<Lang, string>> = {};
  const missingTargets: Lang[] = [];

  if (detectedSource && supabase) {
    const sourceHash = hashSource(detectedSource, text);
    const { data: cached } = await supabase
      .from("translation_cache")
      .select("target_lang, translated_text")
      .eq("source_hash", sourceHash)
      .eq("model", MODEL_HAIKU)
      .in("target_lang", targets);

    for (const row of cached ?? []) {
      const tl = row.target_lang as Lang;
      if (isLang(tl) && targets.includes(tl)) {
        translations[tl] = row.translated_text;
      }
    }

    for (const t of targets) {
      if (!translations[t]) missingTargets.push(t);
    }

    if (missingTargets.length === 0) {
      return { source_lang: detectedSource, translations };
    }
  } else {
    // Auto-Detect oder kein Supabase → alle Targets sind "missing"
    missingTargets.push(...targets);
  }

  // API-Call für fehlende Übersetzungen (+ ggf. Source-Detect)
  try {
    const apiResult = await callHaiku({
      text,
      source_lang: input.source_lang,
      target_langs: missingTargets,
      context,
    });

    detectedSource = apiResult.source_lang;
    for (const [lang, value] of Object.entries(apiResult.translations)) {
      if (isLang(lang) && value) translations[lang] = value;
    }

    // Cache-Write (best-effort, blockiert nicht)
    if (supabase && detectedSource) {
      const sourceHash = hashSource(detectedSource, text);
      const rows = missingTargets
        .filter((t) => translations[t])
        .map((t) => ({
          source_hash: sourceHash,
          target_lang: t,
          translated_text: translations[t]!,
          model: MODEL_HAIKU,
          context,
        }));
      if (rows.length > 0) {
        await supabase.from("translation_cache").upsert(rows, {
          onConflict: "source_hash,target_lang,model",
          ignoreDuplicates: true,
        });
      }
    }

    return { source_lang: detectedSource ?? "en", translations };
  } catch (err) {
    console.error("[translate] haiku call failed", err);
    return {
      source_lang: detectedSource ?? "en",
      translations,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Prüft, ob Sprach-A == Sprach-B (für No-Op-Detection in Callern).
 */
export function sameLanguage(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

// ============================================================================
// Haiku-Call mit Domain-Glossar
// ============================================================================

const GLOSSARY_BLOCK = renderGlossaryForPrompt();

const CONTEXT_HINTS: Record<TranslationContext, string> = {
  chat: "Informeller Chat-Ton, keine Anrede-Floskeln, Länge≈Original. Smileys/Emojis bleiben.",
  listing:
    "Immobilien-Anzeigentext: knapp, sachlich, marktüblich. Maße und Preise unverändert übernehmen.",
  email: "Formeller, aber freundlicher E-Mail-Ton.",
  system: "Neutrale, klare Systemnachricht.",
};

type HaikuTranslateResult = {
  source_lang: Lang;
  translations: Partial<Record<Lang, string>>;
};

async function callHaiku(args: {
  text: string;
  source_lang: Lang | "auto";
  target_langs: Lang[];
  context: TranslationContext;
}): Promise<HaikuTranslateResult> {
  const anthropic = getAnthropic();

  const sourceClause =
    args.source_lang === "auto"
      ? `Erkenne zuerst die Quell-Sprache (eine von: de, en, ru, el).`
      : `Quell-Sprache: ${args.source_lang}.`;

  const targetList = args.target_langs.join(", ");
  const styleHint = CONTEXT_HINTS[args.context];

  const systemPrompt = [
    "Du bist ein präziser Übersetzer für Immobilienkommunikation.",
    "Halte dich strikt an folgendes Domain-Glossar:",
    GLOSSARY_BLOCK,
    "",
    `Stil-Vorgabe: ${styleHint}`,
    "",
    "Antworte AUSSCHLIESSLICH mit gültigem JSON in dieser Form:",
    `{"source_lang":"<de|en|ru|el>","translations":{"<lang>":"<text>",...}}`,
    "Keine Erklärungen, kein Markdown, kein Code-Fence.",
  ].join("\n");

  const userPrompt = [
    sourceClause,
    `Ziel-Sprachen: ${targetList}.`,
    `Übersetze nur in die Ziel-Sprachen, nicht in die Quell-Sprache.`,
    "",
    "TEXT:",
    args.text,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 1024,
    temperature: 0,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  // Erste Text-Block extrahieren
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text" || !textBlock.text) {
    throw new Error("haiku_empty_response");
  }

  // JSON-Parse mit Fallback (Modell könnte Trailing-Whitespace produzieren)
  const cleaned = textBlock.text.trim().replace(/^```json\n?|\n?```$/g, "");
  const parsed = JSON.parse(cleaned) as {
    source_lang?: string;
    translations?: Record<string, string>;
  };

  const source = parsed.source_lang && isLang(parsed.source_lang)
    ? parsed.source_lang
    : args.source_lang === "auto"
      ? "en"
      : args.source_lang;

  const translations: Partial<Record<Lang, string>> = {};
  for (const [lang, value] of Object.entries(parsed.translations ?? {})) {
    if (isLang(lang) && typeof value === "string") {
      translations[lang] = value;
    }
  }

  return { source_lang: source, translations };
}

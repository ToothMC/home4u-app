"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Sprach-Auswahl im Header — vier Flaggen, klickbar.
 *
 * - Eingeloggt: speichert in profiles.preferred_language via PATCH /api/profile
 * - Anon: speichert in Cookie home4u_lang (1 Jahr)
 *
 * Sophie + Match-Notifier lesen diese Präferenz und antworten in der
 * gewählten Sprache. Eine echte i18n-UI-Übersetzung kommt später —
 * bis dahin ist das ein Future-Proof-Setting.
 */

type Lang = "de" | "en" | "ru" | "el";

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "ru", flag: "🇷🇺", label: "Русский" },
  { code: "el", flag: "🇬🇷", label: "Ελληνικά" },
];

const COOKIE_NAME = "home4u_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

export function LanguageFlagPicker({
  /** Optional Initial-Sprache vom Server (wenn schon aus Profil bekannt). */
  initial,
  /** Kompakter: nur Flaggen, kein Label. Default true. */
  compact = true,
  className,
}: {
  initial?: Lang | null;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = React.useState<Lang | null>(initial ?? null);
  const [busy, setBusy] = React.useState<Lang | null>(null);

  // Initial aus Cookie lesen wenn nichts vom Server kam
  React.useEffect(() => {
    if (current) return;
    const fromCookie = readCookie(COOKIE_NAME) as Lang | null;
    if (fromCookie && LANGS.some((l) => l.code === fromCookie)) {
      setCurrent(fromCookie);
    }
  }, [current]);

  async function pick(code: Lang) {
    if (busy) return;
    setBusy(code);
    setCurrent(code);

    // Cookie immer setzen — egal ob auth oder anon. So weiß der Server
    // beim nächsten Request sofort die Sprache.
    writeCookie(COOKIE_NAME, code);

    // Wenn auth: zusätzlich ins Profil persistieren
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preferred_language: code }),
        }).catch(() => {});
      }
    } catch {
      // ignore — Cookie-Pfad reicht als Fallback
    }

    router.refresh();
    setBusy(null);
  }

  return (
    <div
      className={
        "flex items-center gap-0.5 rounded-full bg-white/40 backdrop-blur border border-[var(--border)] px-1 py-1 " +
        (className ?? "")
      }
      role="radiogroup"
      aria-label="Sprache wählen"
    >
      {LANGS.map((l) => {
        const active = current === l.code;
        return (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={l.label}
            title={l.label}
            onClick={() => pick(l.code)}
            disabled={busy === l.code}
            className={
              "size-7 inline-flex items-center justify-center rounded-full text-base leading-none transition-all " +
              (active
                ? "ring-2 ring-emerald-500 bg-white shadow-sm scale-110"
                : "opacity-60 hover:opacity-100 hover:scale-105 hover:bg-white/60")
            }
          >
            <span aria-hidden>{l.flag}</span>
            {!compact && (
              <span className="ml-1 text-[10px] font-medium uppercase">
                {l.code}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

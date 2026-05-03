"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Sprach-Auswahl im Header — Dropdown wie bei meet-sophie.
 * Closed: nur die aktive Flagge sichtbar. Click → Menü mit den anderen
 * Sprachen klappt auf.
 *
 * - Eingeloggt: speichert in profiles.preferred_language via PATCH /api/profile
 * - Anon: speichert in Cookie home4u_lang (1 Jahr)
 */

type Lang = "de" | "en" | "ru" | "el" | "zh";

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "ru", flag: "🇷🇺", label: "Русский" },
  { code: "el", flag: "🇬🇷", label: "Ελληνικά" },
  { code: "zh", flag: "🇨🇳", label: "中文" },
];

const COOKIE_NAME = "home4u_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr
const DEFAULT_LANG: Lang = "de";

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
  initial,
  className,
  labels,
}: {
  initial?: Lang | null;
  className?: string;
  labels?: { title?: string; choose?: string };
}) {
  const titleLabel = labels?.title ?? "Sprache";
  const chooseLabel = labels?.choose ?? "Sprache wählen";
  const router = useRouter();
  const [current, setCurrent] = React.useState<Lang>(initial ?? DEFAULT_LANG);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  // Initial aus Cookie lesen wenn nichts vom Server kam
  React.useEffect(() => {
    if (initial) return;
    const fromCookie = readCookie(COOKIE_NAME) as Lang | null;
    if (fromCookie && LANGS.some((l) => l.code === fromCookie)) {
      setCurrent(fromCookie);
    }
  }, [initial]);

  // Click outside + Escape schließen das Menü
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function pick(code: Lang) {
    setOpen(false);
    if (code === current || busy) return;
    setBusy(true);
    setCurrent(code);

    writeCookie(COOKIE_NAME, code);

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
      // Cookie reicht als Fallback
    }

    router.refresh();
    setBusy(false);
  }

  const active = LANGS.find((l) => l.code === current) ?? LANGS[0];

  return (
    <div ref={wrapRef} className={"relative flex-shrink-0 " + (className ?? "")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${titleLabel}: ${active.label}`}
        title={active.label}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white/60 backdrop-blur px-2 py-1 hover:bg-white transition-colors"
      >
        <span className="text-base leading-none" aria-hidden>
          {active.flag}
        </span>
        <ChevronDown className="size-3 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={chooseLabel}
          className="absolute right-0 mt-1 w-44 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden z-50"
        >
          {LANGS.map((l) => {
            const selected = l.code === current;
            return (
              <li key={l.code} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => pick(l.code)}
                  className={
                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--accent)] transition-colors " +
                    (selected ? "font-medium bg-emerald-50/60" : "")
                  }
                >
                  <span className="text-base leading-none" aria-hidden>
                    {l.flag}
                  </span>
                  <span>{l.label}</span>
                  {selected && (
                    <span className="ml-auto text-xs text-emerald-700">✓</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

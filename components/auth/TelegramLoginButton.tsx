"use client";

/**
 * Telegram-Login-Widget-Wrapper.
 *
 * Embeds das offizielle Telegram-Login-Widget-Script und routet die
 * Auth-Daten an /api/auth/telegram-login (HMAC-Verify + Session-Setup).
 *
 * Nutzung:
 *   <TelegramLoginButton botUsername="home4u_sophie_bot" next="/dashboard" />
 *
 * Voraussetzung: BotFather muss `/setdomain` auf home4u.ai gesetzt haben,
 * sonst zeigt das Widget einen "Bot domain not set"-Fehler.
 */
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function TelegramLoginButton({
  botUsername,
  next,
  size = "large",
  cornerRadius = 8,
  requestAccess = "write",
  onError,
}: {
  /** Bot-Username ohne @, z.B. "home4u_sophie_bot". Aus NEXT_PUBLIC_TELEGRAM_BOT_USERNAME. */
  botUsername?: string;
  /** Wohin nach erfolgreichem Login redirecten (Default: /dashboard). */
  next?: string;
  size?: "large" | "medium" | "small";
  cornerRadius?: number;
  /** "write" = Widget bittet um Schreibrechte (für späteren Bot-Outreach). */
  requestAccess?: "write" | "read";
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const username =
    botUsername ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  useEffect(() => {
    if (!username || !containerRef.current) return;

    // Globaler Callback, den das Telegram-Widget aufruft
    window.onTelegramAuth = async (tgUser: Record<string, unknown>) => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/auth/telegram-login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: tgUser, next }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(
            data.detail ?? data.error ?? "telegram_login_failed"
          );
        }
        if (data.redirect && typeof data.redirect === "string") {
          window.location.href = data.redirect;
        } else {
          window.location.reload();
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        setErrorMsg(m);
        onError?.(m);
      } finally {
        setSubmitting(false);
      }
    };

    // Widget-Script injizieren (idempotent: ältere Scripts entfernen)
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.dataset.telegramLogin = username;
    script.dataset.size = size;
    script.dataset.radius = String(cornerRadius);
    script.dataset.requestAccess = requestAccess;
    script.dataset.onauth = "onTelegramAuth(user)";
    script.dataset.userpic = "false";
    containerRef.current.appendChild(script);

    return () => {
      // Cleanup
      delete window.onTelegramAuth;
    };
  }, [username, next, size, cornerRadius, requestAccess, onError]);

  if (!username) {
    return (
      <div className="text-xs text-[var(--muted-foreground)]">
        Telegram-Login nicht konfiguriert (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME fehlt).
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} aria-busy={submitting} />
      {submitting && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Telegram-Login wird verarbeitet…
        </p>
      )}
      {errorMsg && (
        <p className="text-xs text-[var(--destructive)]">{errorMsg}</p>
      )}
    </div>
  );
}

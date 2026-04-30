"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mail, LogIn, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "email" | "code" | "success";

export function SignInDialog({
  open,
  onOpenChange,
  onSignedIn,
  redirectAfter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn?: (info: { email: string }) => void;
  /** Wenn gesetzt: nach Login dorthin navigieren statt window.location.reload(). */
  redirectAfter?: string;
}) {
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("email");
      setEmail("");
      setCode("");
      setError(null);
      setCooldownEnd(null);
    }
  }, [open]);

  useEffect(() => {
    if (mode === "code") codeInputRef.current?.focus();
  }, [mode]);

  // Auto-Submit: 8-stelliger Code sofort, 6-stelliger nach kurzer Ruhezeit
  // (damit 7/8-stellige Eingaben nicht versehentlich gesendet werden).
  const verifyRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (mode !== "code" || busy) return;
    if (code.length < 6 || code.length > 8) return;
    const delay = code.length === 8 ? 0 : 700;
    const t = setTimeout(() => verifyRef.current(), delay);
    return () => clearTimeout(t);
  }, [code, mode, busy]);

  async function sendOtp(opts?: { resend?: boolean }) {
    if (!email || busy) return;
    if (cooldownEnd && Date.now() < cooldownEnd && !opts?.resend) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "send_failed");
      }
      setMode("code");
      setCooldownEnd(Date.now() + 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  verifyRef.current = verify;

  async function verify() {
    if (code.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "verify_failed");
      }
      // Browser-Client-Session refresh, damit getUser() im UI ebenfalls den User sieht
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.getSession();
      } catch {
        // ignore
      }
      setMode("success");
      onSignedIn?.({ email });
      setTimeout(() => {
        onOpenChange(false);
        if (redirectAfter && redirectAfter.startsWith("/")) {
          window.location.href = redirectAfter;
        } else {
          window.location.reload();
        }
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Body-Lock: verhindert Scrollen der Hintergrund-Page während Dialog offen.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // createPortal nach document.body — umgeht das Problem dass fixed-positioning
  // bei ancestor mit transform/filter/perspective zur containing-block wird
  // (Header/Layout-Wrapper können `fixed` sonst kapern → Dialog erscheint
  // an falscher Stelle).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--background)] p-6 shadow-lg relative">
        <button
          onClick={() => onOpenChange(false)}
          aria-label="Schließen"
          className="absolute right-3 top-3 p-1 hover:bg-[var(--accent)] rounded-md"
        >
          <X className="size-4" />
        </button>

        {mode === "email" && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <LogIn className="size-4" /> Anmelden
              </h2>
              <p className="text-sm text-[var(--muted-foreground)] mt-1">
                Wir schicken dir einen Code per E-Mail.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendOtp();
              }}
              className="space-y-3"
            >
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="du@beispiel.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
              />
              <Button type="submit" className="w-full" disabled={busy || !email}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Code senden
              </Button>
            </form>
            {error && (
              <p className="mt-3 text-sm text-[var(--destructive)]">{error}</p>
            )}
          </div>
        )}

        {mode === "code" && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Code eingeben</h2>
              <p className="text-sm text-[var(--muted-foreground)] mt-1">
                Wir haben einen Code an <strong>{email}</strong> geschickt.
                Schau in deinem Posteingang nach.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify();
              }}
              className="space-y-3"
            >
              <Input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6,8}"
                placeholder="12345678"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                disabled={busy}
                className="text-center tracking-[0.3em] text-lg"
                required
              />
              <Button
                type="submit"
                className="w-full"
                disabled={busy || code.length < 6}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Anmelden
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setMode("email");
                    setCode("");
                    setError(null);
                  }}
                  className="text-[var(--muted-foreground)] hover:underline"
                >
                  ← andere E-Mail
                </button>
                <ResendButton
                  cooldownEnd={cooldownEnd}
                  onResend={() => sendOtp({ resend: true })}
                  disabled={busy}
                />
              </div>
            </form>
            {error && (
              <p className="mt-3 text-sm text-[var(--destructive)]">{error}</p>
            )}
          </div>
        )}

        {mode === "success" && (
          <div className="py-8 text-center">
            <p className="text-lg font-semibold">Eingeloggt ✓</p>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Moment …
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ResendButton({
  cooldownEnd,
  onResend,
  disabled,
}: {
  cooldownEnd: number | null;
  onResend: () => void;
  disabled?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = cooldownEnd ? Math.max(0, cooldownEnd - now) : 0;
  const secs = Math.ceil(remaining / 1000);
  if (remaining > 0) {
    return (
      <span className="text-[var(--muted-foreground)]">
        erneut in {secs}s
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onResend}
      disabled={disabled}
      className="text-[var(--primary)] hover:underline disabled:opacity-50"
    >
      Code erneut senden
    </button>
  );
}

"use client";

import * as React from "react";
import { Heart, Share2, Check, Link as LinkIcon } from "lucide-react";
import { SignInDialog } from "@/components/auth/SignInDialog";

type Props = {
  listingId: string;
  /** Initial-Status vom Server: true wenn der User dieses Listing schon
   *  gespeichert hat (aus listing_bookmarks). */
  initialSaved: boolean;
  /** Server-seitig ermittelt: true wenn ein eingeloggter User vorliegt.
   *  Anonyme Besucher sehen den Save-Button, ein Klick öffnet aber den
   *  Login-Dialog statt zu speichern — Favoriten gibt es nur mit Account. */
  isAuthenticated: boolean;
  /** Title fürs Share-Sheet (Web Share API), idealerweise kurz. */
  shareTitle: string;
  /** Optional: knapper Text fürs Teilen (~1 Zeile). */
  shareText?: string;
};

type Toast = { kind: "ok" | "err"; msg: string; t: number } | null;

export function ListingHeaderActions({
  listingId,
  initialSaved,
  isAuthenticated,
  shareTitle,
  shareText,
}: Props) {
  const [saved, setSaved] = React.useState(initialSaved);
  const [authed, setAuthed] = React.useState(isAuthenticated);
  const [busy, setBusy] = React.useState<"save" | "share" | null>(null);
  const [toast, setToast] = React.useState<Toast>(null);
  const [signInOpen, setSignInOpen] = React.useState(false);
  // Wenn der User über den Dialog einloggt: nach Erfolg automatisch
  // einmal den Save-Toggle ausführen, damit der ursprüngliche Klick
  // nicht "verschluckt" wird.
  const pendingSaveRef = React.useRef(false);

  // Toast auto-dismiss nach 2.5s
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSave() {
    // Anon-Klick → Login-Dialog öffnen, nicht speichern. Favoriten
    // sind explizit auth-only.
    if (!authed) {
      pendingSaveRef.current = true;
      setSignInOpen(true);
      return;
    }
    setBusy("save");
    // Optimistic UI-Update — bei Fehler revertieren
    const prev = saved;
    setSaved(!prev);
    try {
      const res = await fetch(`/api/bookmarks/${listingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "public-page" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.saved !== "boolean") {
        setSaved(prev);
        setToast({ kind: "err", msg: json.error ?? "Konnte nicht speichern", t: Date.now() });
        return;
      }
      setSaved(json.saved);
      setToast({
        kind: "ok",
        msg: json.saved ? "In Favoriten gespeichert" : "Aus Favoriten entfernt",
        t: Date.now(),
      });
    } catch {
      setSaved(prev);
      setToast({ kind: "err", msg: "Netzwerkfehler", t: Date.now() });
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (typeof window === "undefined") return;
    setBusy("share");
    const url = window.location.origin + window.location.pathname;
    try {
      // Web Share API: Mobile + Safari/Chrome Desktop unterstützen das.
      // Öffnet das native Share-Sheet (WhatsApp, Email, AirDrop, ...).
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText ?? shareTitle,
          url,
        });
        // Kein Erfolgs-Toast — das System-Sheet zeigt das Feedback selbst.
      } else if (navigator.clipboard) {
        // Fallback: Link in die Zwischenablage kopieren
        await navigator.clipboard.writeText(url);
        setToast({ kind: "ok", msg: "Link kopiert", t: Date.now() });
      } else {
        setToast({ kind: "err", msg: "Teilen wird nicht unterstützt", t: Date.now() });
      }
    } catch (err) {
      // User hat den Share-Dialog abgebrochen → kein Fehler
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (!isAbort) {
        setToast({ kind: "err", msg: "Teilen fehlgeschlagen", t: Date.now() });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy === "save"}
          aria-label={saved ? "Aus Favoriten entfernen" : "Speichern"}
          aria-pressed={saved}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <Heart
            className={
              saved
                ? "size-4 fill-rose-500 stroke-rose-500"
                : "size-4"
            }
          />
          <span className="hidden sm:inline">
            {saved ? "Gespeichert" : "Speichern"}
          </span>
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={busy === "share"}
          aria-label="Teilen"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Teilen</span>
        </button>
      </div>

      <SignInDialog
        open={signInOpen}
        onOpenChange={(o) => {
          setSignInOpen(o);
          if (!o) pendingSaveRef.current = false;
        }}
        onSignedIn={() => {
          setAuthed(true);
          setSignInOpen(false);
          if (pendingSaveRef.current) {
            pendingSaveRef.current = false;
            // Nach erfolgreichem Login einmal direkt das Save toggeln —
            // sieht für den User aus, als wäre der ursprüngliche Klick
            // einfach durchgegangen.
            void handleSave();
          }
        }}
      />

      {toast && (
        <div
          className={
            "fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xs rounded-xl shadow-lg px-3 py-2 flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-4 " +
            (toast.kind === "ok"
              ? "bg-emerald-700 text-white"
              : "bg-rose-700 text-white")
          }
          role="status"
          aria-live="polite"
        >
          {toast.kind === "ok" ? (
            <Check className="size-4 shrink-0" />
          ) : (
            <LinkIcon className="size-4 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}
    </>
  );
}

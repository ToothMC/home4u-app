"use client";

import * as React from "react";
import { Heart } from "lucide-react";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { useT } from "@/lib/i18n/client";

type Props = {
  listingId: string;
  initialSaved: boolean;
  isAuthenticated: boolean;
};

export function BrowseFavoriteButton({
  listingId,
  initialSaved,
  isAuthenticated,
}: Props) {
  const { t } = useT();
  const [saved, setSaved] = React.useState(initialSaved);
  const [authed, setAuthed] = React.useState(isAuthenticated);
  const [busy, setBusy] = React.useState(false);
  const [signInOpen, setSignInOpen] = React.useState(false);
  const pendingSaveRef = React.useRef(false);

  async function doToggle() {
    setBusy(true);
    const prev = saved;
    setSaved(!prev);
    try {
      const res = await fetch(`/api/bookmarks/${listingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "browse" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        saved?: boolean;
      };
      if (!res.ok || typeof json.saved !== "boolean") {
        setSaved(prev);
        return;
      }
      setSaved(json.saved);
    } catch {
      setSaved(prev);
    } finally {
      setBusy(false);
    }
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Karte ist ein <Link> — Klick auf Herz darf nicht zur Detail-Seite navigieren.
    e.preventDefault();
    e.stopPropagation();
    if (!authed) {
      pendingSaveRef.current = true;
      setSignInOpen(true);
      return;
    }
    void doToggle();
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label={saved ? t("headerActions.removeFromFavs") : t("headerActions.save")}
        aria-pressed={saved}
        className="absolute right-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/85 backdrop-blur shadow-sm hover:bg-white transition-colors disabled:opacity-60"
      >
        <Heart
          className={
            saved
              ? "size-4 fill-rose-500 stroke-rose-500"
              : "size-4 text-[var(--brand-navy)]"
          }
        />
      </button>

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
            void doToggle();
          }
        }}
      />
    </>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function DeleteBookmarkOverlay({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = React.useState(false);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t("delBookmark.confirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bookmarks/${listingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setBusy(false);
        alert(t("delBookmark.error"));
        return;
      }
      router.refresh();
    } catch {
      setBusy(false);
      alert(t("btn.networkError"));
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={t("headerActions.removeFromFavs")}
      className="absolute top-2 right-2 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/90 backdrop-blur shadow-sm text-[var(--muted-foreground)] hover:text-red-600 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </button>
  );
}

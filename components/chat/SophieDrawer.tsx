"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { MessageCircle, X } from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import type { SidekickContext } from "@/lib/sophie/sidekick-context";
import { useT } from "@/lib/i18n/client";

/**
 * Sidekick-Drawer für Sophie. Öffnet sich aus einem Trigger heraus
 * (Pill-Button oder FAB), enthält eine eingebettete ChatView und gibt
 * dem Chat den UI-Kontext (aktuelle Filter / aktuelles Listing) mit.
 *
 * Mobile (< sm): Full-Screen Bottom-Sheet.
 * Desktop:       Rechter Slide-in (max-w-[440px]).
 */
export function SophieDrawer({
  open,
  onOpenChange,
  context,
  seed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: SidekickContext;
  seed: string;
}) {
  const { t } = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="
            fixed z-50 bg-[var(--background)] shadow-2xl flex flex-col
            inset-x-0 bottom-0 h-[85dvh] rounded-t-2xl
            sm:inset-x-auto sm:bottom-0 sm:top-0 sm:right-0 sm:h-[100dvh] sm:w-[440px] sm:max-w-[90vw] sm:rounded-none sm:rounded-l-2xl
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom
            sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right
          "
        >
          <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--warm-cream)]/85 backdrop-blur px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sophie/apple-touch-icon.png"
              alt="Sophie"
              width={36}
              height={36}
              className="size-9 rounded-full object-cover ring-2 ring-[var(--brand-gold)]/40 shadow-[0_4px_12px_-4px_rgb(26_46_68/30%)]"
            />
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-semibold leading-tight text-[var(--brand-navy)]">
                {t("sidekick.title")}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-[var(--warm-bark)] leading-tight">
                {t("sidekick.subtitle")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label={t("common.close")}
                className="inline-flex size-9 items-center justify-center rounded-full text-[var(--warm-bark)] hover:bg-[var(--accent)] hover:text-[var(--brand-navy)] transition-colors"
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <ChatView embedded context={context} seedOverride={seed} />
          </div>

          {context.page === "stoebern" && (
            <div className="border-t border-[var(--border)] bg-[var(--warm-cream)]/50 px-4 py-2 text-center">
              <Link
                href="/chat?flow=seeker"
                className="text-xs text-[var(--warm-bark)] hover:text-[var(--brand-navy)] underline-offset-2 hover:underline transition-colors"
              >
                {t("sidekick.crossLink.fullChat")}
              </Link>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Trigger-Pille (z.B. neben dem Filter-Bar). Übernimmt selber den Open-State,
 * damit der Caller nur Context + Seed liefert.
 */
export function SophieDrawerTrigger({
  context,
  seed,
  label,
  className,
  variant = "pill",
}: {
  context: SidekickContext;
  seed: string;
  label?: string;
  className?: string;
  variant?: "pill" | "fab";
}) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const text = label ?? t("sidekick.trigger.label");

  return (
    <>
      {variant === "fab" ? (
        <button
          type="button"
          aria-label={text}
          onClick={() => setOpen(true)}
          className={
            "fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-[var(--brand-navy)] text-white px-4 py-3 shadow-lg hover:bg-[var(--brand-navy)]/90 transition-colors " +
            (className ?? "")
          }
        >
          <MessageCircle className="size-5" />
          <span className="hidden sm:inline text-sm font-medium">{text}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            "inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-gold-300)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)] hover:border-[var(--brand-gold)] transition-colors shadow-sm " +
            (className ?? "")
          }
        >
          <MessageCircle className="size-3.5 text-[var(--brand-gold)]" />
          {text}
        </button>
      )}

      <SophieDrawer
        open={open}
        onOpenChange={setOpen}
        context={context}
        seed={seed}
      />
    </>
  );
}

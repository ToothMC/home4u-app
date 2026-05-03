"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

type Item = { key: TKey; href: string };

const ITEMS: Item[] = [
  { key: "nav.search", href: "/chat?flow=seeker" },
  { key: "nav.rentOut", href: "/chat?flow=owner" },
  { key: "nav.sell", href: "/chat?flow=owner&intent=sale" },
  { key: "nav.wantedAds", href: "/gesuche" },
  { key: "nav.forAgents", href: "/chat?flow=agent" },
  { key: "nav.scamCheck", href: "/scam-check" },
];

export function MobileNav({
  onFeedbackClick,
}: {
  onFeedbackClick?: () => void;
} = {}) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("mobileNav.open")}
        aria-expanded={open}
        className="lg:hidden inline-flex size-9 items-center justify-center rounded-full text-[var(--brand-navy,#0a1f3a)] hover:bg-[var(--brand-gold-50,#fef3e2)] hover:text-[var(--brand-gold,#c9a14a)] transition-colors"
      >
        <Menu className="size-5" />
      </button>

      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("mobileNav.close")}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <nav
          aria-label={t("mobileNav.menu")}
          className={cn(
            "absolute top-0 right-0 h-screen w-[80%] max-w-xs bg-white shadow-xl",
            "transition-transform duration-200",
            open ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="absolute top-0 inset-x-0 h-14 flex items-center justify-between px-5 border-b border-neutral-200 bg-white">
            <span className="text-sm font-medium text-neutral-800">{t("mobileNav.menu")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("mobileNav.close")}
              className="inline-flex size-8 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
            >
              <X className="size-5" />
            </button>
          </div>

          <div
            className="absolute inset-x-0 top-14 bottom-14 overflow-y-auto bg-white"
            data-mobile-nav-items
          >
            <ul className="py-2">
              {ITEMS.map((it) => (
                <li key={it.key}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="block w-full px-5 py-3 text-base text-neutral-800 hover:bg-neutral-100 transition-colors"
                  >
                    {t(it.key)}
                  </Link>
                </li>
              ))}
              {onFeedbackClick && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onFeedbackClick();
                    }}
                    className="flex w-full items-center gap-2 px-5 py-3 text-base text-neutral-800 hover:bg-neutral-100 transition-colors"
                  >
                    <MessageSquare className="size-4" />
                    {t("feedback.button.label")}
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div className="absolute bottom-0 inset-x-0 h-14 flex items-center px-5 border-t border-neutral-200 bg-white">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-neutral-800 hover:text-neutral-600 transition-colors"
            >
              {t("common.dashboard")} →
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}

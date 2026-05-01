"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Plain Link statt ChatLink (das useSearchParams() nutzt) — sonst muss
// jede Page die AuthMenu rendert in Suspense gewrapped werden, sonst
// schlägt der Production-Build mit "missing-suspense-with-csr-bailout"
// fehl. Region-Param-Preservation ist beim Burger-Entry nicht kritisch.
type Item = { label: string; href: string };

const ITEMS: Item[] = [
  { label: "Suchen", href: "/chat?flow=seeker" },
  { label: "Vermieten", href: "/chat?flow=owner" },
  { label: "Verkaufen", href: "/chat?flow=owner&intent=sale" },
  { label: "Such-Inserate", href: "/gesuche" },
  { label: "Für Makler", href: "/chat?flow=agent" },
  { label: "Scam-Check", href: "/scam-check" },
];

export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  // ESC zum Schließen + Body-Scroll-Lock während offen
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
        aria-label="Menü öffnen"
        aria-expanded={open}
        className="lg:hidden inline-flex size-9 items-center justify-center rounded-full text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)] hover:text-[var(--brand-gold)] transition-colors"
      >
        <Menu className="size-5" />
      </button>

      {/* Overlay + Drawer */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Menü schließen"
          className="absolute inset-0 bg-[var(--brand-navy)]/60 backdrop-blur-sm"
        />

        {/* Panel von rechts einschwebend */}
        <nav
          className={cn(
            "absolute top-0 right-0 h-full w-[80%] max-w-xs bg-[var(--warm-cream)] shadow-xl flex flex-col",
            "transition-transform duration-200",
            open ? "translate-x-0" : "translate-x-full"
          )}
          aria-label="Hauptnavigation"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <span className="text-sm font-medium text-[var(--brand-navy)]">Menü</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Menü schließen"
              className="inline-flex size-8 items-center justify-center rounded-full text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)]"
            >
              <X className="size-5" />
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto py-2">
            {ITEMS.map((it) => (
              <li key={it.label}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="block w-full px-5 py-3 text-base text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)] hover:text-[var(--brand-gold)] transition-colors"
                >
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--border)] px-5 py-3">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="block text-sm font-medium text-[var(--brand-navy)] hover:text-[var(--brand-gold)] transition-colors"
            >
              Dashboard →
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}

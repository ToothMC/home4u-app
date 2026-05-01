"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Plain Link statt ChatLink (das useSearchParams() nutzt) — sonst muss
// jede Page die AuthMenu rendert in Suspense gewrapped werden, sonst
// schlägt der Production-Build mit "missing-suspense-with-csr-bailout"
// fehl.
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
        className="lg:hidden inline-flex size-9 items-center justify-center rounded-full text-[var(--brand-navy,#0a1f3a)] hover:bg-[var(--brand-gold-50,#fef3e2)] hover:text-[var(--brand-gold,#c9a14a)] transition-colors"
      >
        <Menu className="size-5" />
      </button>

      {/* Overlay — fixed inset-0, full viewport */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
      >
        {/* Backdrop click-to-close */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Menü schließen"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Panel — explizit h-screen + bg-white statt CSS-var damit's robust ist.
            Statt flex-col + flex-1 (das auf manchen Pages kollabiert): klassisches
            Layout mit absolutem header/footer und scroll-bereich dazwischen. */}
        <nav
          aria-label="Hauptnavigation"
          className={cn(
            "absolute top-0 right-0 h-screen w-[80%] max-w-xs bg-white shadow-xl",
            "transition-transform duration-200",
            open ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* Header */}
          <div className="absolute top-0 inset-x-0 h-14 flex items-center justify-between px-5 border-b border-neutral-200 bg-white">
            <span className="text-sm font-medium text-neutral-800">Menü</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Menü schließen"
              className="inline-flex size-8 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Scroll-Bereich für die Items — explizite top/bottom-Offsets statt
              flex-1, damit die Items garantiert sichtbar sind. */}
          <div
            className="absolute inset-x-0 top-14 bottom-14 overflow-y-auto bg-white"
            data-mobile-nav-items
          >
            <ul className="py-2">
              {ITEMS.map((it) => (
                <li key={it.label}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="block w-full px-5 py-3 text-base text-neutral-800 hover:bg-neutral-100 transition-colors"
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <div className="absolute bottom-0 inset-x-0 h-14 flex items-center px-5 border-t border-neutral-200 bg-white">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-neutral-800 hover:text-neutral-600 transition-colors"
            >
              Dashboard →
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}

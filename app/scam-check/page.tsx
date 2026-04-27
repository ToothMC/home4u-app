import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuthMenu } from "@/components/auth/AuthMenu";
import { ScamCheckClient } from "@/components/scam-shield/ScamCheckClient";

export const metadata: Metadata = {
  title: "Scam-Check — Sophie prüft dein Inserat",
  description:
    "Schick Sophie ein verdächtiges Wohnungs-Inserat aus Zypern. Sie sagt dir, ob es Scam ist. 3 Checks pro Monat kostenlos.",
};

export default function ScamCheckPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 pb-2 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Zurück
        </Link>
        <AuthMenu />
      </header>

      <div className="max-w-2xl mx-auto mb-10 mt-8 text-center space-y-3 px-4">
        <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)]">
          Schick Sophie dein Inserat.
        </h1>
        <p className="text-lg text-[var(--muted-foreground)]">
          Sie sagt dir, ob es Scam ist.
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          3 kostenlose Checks pro Monat · keine Anmeldung nötig
        </p>
      </div>

      <div className="px-4 pb-12">
        <ScamCheckClient />
      </div>
    </main>
  );
}

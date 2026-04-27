import type { Metadata } from "next";

import { ScamCheckClient } from "@/components/scam-shield/ScamCheckClient";

export const metadata: Metadata = {
  title: "Scam-Check — Sophie prüft dein Inserat",
  description:
    "Schick Sophie ein verdächtiges Wohnungs-Inserat aus Zypern. Sie sagt dir, ob es Scam ist. 3 Checks pro Monat kostenlos.",
};

export default function ScamCheckPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] py-12 px-4">
      <div className="max-w-2xl mx-auto mb-10 text-center space-y-3">
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

      <ScamCheckClient />
    </main>
  );
}

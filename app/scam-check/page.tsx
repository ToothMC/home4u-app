import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { AuthMenu } from "@/components/auth/AuthMenu";
import { Button } from "@/components/ui/button";
import { ScamCheckClient } from "@/components/scam-shield/ScamCheckClient";
import { getAuthUser } from "@/lib/supabase/auth";

export const metadata: Metadata = {
  title: "Scam-Check — Sophie prüft dein Inserat",
  description:
    "Schick Sophie ein verdächtiges Wohnungs-Inserat aus Zypern. Sie sagt dir, ob es Scam ist. Mit Home4U-Login kostenlos.",
};

export default async function ScamCheckPage() {
  const user = await getAuthUser();

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
          3 kostenlose Checks pro Monat
        </p>
      </div>

      <div className="px-4 pb-12">
        {user ? (
          <ScamCheckClient />
        ) : (
          <LoginPrompt />
        )}
      </div>
    </main>
  );
}

function LoginPrompt() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border bg-[var(--card)] p-6 text-center space-y-4">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
        <ShieldCheck className="size-6" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
        Für die Verwendung des Scam-Checkers bitte erst einloggen.
      </h2>
      <p className="text-sm text-[var(--muted-foreground)]">
        Du bekommst 3 kostenlose Checks pro Monat — wir brauchen einen Login,
        damit wir die Quote pro Person sauber zählen können und kein Spam-
        Missbrauch entsteht.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
        <Button asChild>
          <Link href="/?auth=required&next=/scam-check">Anmelden</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/?auth=required&next=/scam-check&mode=signup">
            Konto erstellen
          </Link>
        </Button>
      </div>
    </div>
  );
}

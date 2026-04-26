import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, MessageCircle } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { Button } from "@/components/ui/button";
import { MatchBrowser } from "@/components/match-browse/MatchBrowser";
import { findMatchesForSession } from "@/lib/repo/listings";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const user = await getAuthUser();
  const session = user ? null : await getOrCreateAnonymousSession();

  // Mehr Matches laden als die Karte zeigt — User soll längere Sessions
  // browsen können ohne Re-Fetch
  const matches = await findMatchesForSession(
    {
      userId: user?.id ?? null,
      anonymousId: session?.anonymousId ?? null,
    },
    50
  );

  // Wenn kein Suchprofil existiert → zurück in den Chat zum Anlegen
  if (matches.length === 0 && !user) {
    redirect("/chat?seed=seeker");
  }

  return (
    // Viewport-locked Layout — kein Page-Scroll, damit interner Image-Swipe
    // und Page-Scroll nicht gegeneinander kämpfen. dvh statt vh: passt sich
    // an iOS-Safari-Toolbar an, ohne dass die Card hin- und herspringt.
    <main className="flex flex-col h-[100dvh] overflow-hidden">
      <header className="shrink-0 mx-auto max-w-3xl w-full px-4 pt-3 pb-2 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted-foreground)] hover:underline"
        >
          ← Dashboard
        </Link>
        <AuthMenu hideDashboard />
      </header>

      <section className="mx-auto max-w-md w-full px-4 pb-3 flex-1 flex flex-col min-h-0">
        <div className="shrink-0 mb-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Search className="size-5" />
            Deine Treffer
          </h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            {matches.length === 0
              ? "Keine passenden Inserate aktuell — Sophie sucht weiter."
              : `${matches.length} Inserate sortiert nach Passung.`}
          </p>
        </div>

        {matches.length === 0 ? (
          <EmptyState />
        ) : (
          <MatchBrowser matches={matches} />
        )}
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Wir haben noch keine Treffer für dein Profil. Erzähl Sophie ein
        bisschen mehr — Lage, Budget, Wohnform — dann finden wir dir was.
      </p>
      <Button asChild>
        <Link href="/chat">
          <MessageCircle className="size-4" /> Mit Sophie chatten
        </Link>
      </Button>
    </div>
  );
}

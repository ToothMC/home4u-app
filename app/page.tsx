import { Suspense } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatLink, PathCards } from "@/components/landing/PathCards";
import { RegionPicker } from "@/components/landing/RegionPicker";
import { AuthMenu } from "@/components/auth/AuthMenu";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-4 pt-4 flex justify-end">
        <AuthMenu />
      </div>
      <section className="mx-auto max-w-5xl px-4 pt-8 pb-10 sm:pt-16 sm:pb-12 text-center">
        <p className="text-sm uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
          Home4U
        </p>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight mb-6">
          Schreib Sophie.
          <br />
          <span className="text-[var(--muted-foreground)]">
            Sie findet dein Zuhause.
          </span>
        </h1>
        <p className="mx-auto max-w-2xl text-base sm:text-lg text-[var(--muted-foreground)] mb-8">
          KI-gestützte Immobilienplattform mit Double-Match-Prinzip. Kein
          Kontakt-Chaos, keine Scam-Köder — nur Angebote, die wirklich passen.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Suspense
            fallback={
              <Button size="lg" disabled>
                <MessageCircle />
                Mit Sophie chatten
              </Button>
            }
          >
            <Button asChild size="lg">
              <ChatLink>
                <MessageCircle className="mr-1" />
                Mit Sophie chatten
                <ArrowRight />
              </ChatLink>
            </Button>
          </Suspense>
          <Button asChild size="lg" variant="outline">
            <a href="#region">Region wählen</a>
          </Button>
        </div>
      </section>

      <section id="region" className="mx-auto max-w-5xl px-4 py-8">
        <Suspense
          fallback={
            <div className="rounded-xl border p-6 text-sm text-[var(--muted-foreground)]">
              Region lädt …
            </div>
          }
        >
          <RegionPicker />
        </Suspense>
      </section>

      <section id="pfade" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-2xl sm:text-3xl font-semibold mb-8 text-center">
          Drei Wege zu Home4U
        </h2>
        <Suspense
          fallback={
            <div className="text-center text-sm text-[var(--muted-foreground)]">
              Lädt…
            </div>
          }
        >
          <PathCards />
        </Suspense>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <div className="rounded-xl border p-6 sm:p-10 bg-[var(--accent)]">
          <h3 className="text-xl sm:text-2xl font-semibold mb-3">
            Warum Double-Match?
          </h3>
          <p className="text-[var(--muted-foreground)] mb-4">
            Kontakt entsteht nur, wenn beide Seiten sich gegenseitig als passend
            markieren. Keine Kaltanfragen, keine Belästigung. Sophie verbindet
            euch erst, wenn&apos;s für beide passt.
          </p>
          <ul className="text-sm space-y-2 text-[var(--muted-foreground)]">
            <li>· Echte Lokation Pflicht, Provisionshöhe vorab sichtbar</li>
            <li>
              · Inserate werden nach 14 Tagen ohne Aktivität automatisch
              deaktiviert
            </li>
            <li>· KI-Bild-Check gegen Stockfotos und Duplikate</li>
            <li>· Sophie spricht Deutsch, Englisch, Russisch und Griechisch</li>
          </ul>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-[var(--muted-foreground)] border-t">
        <div className="flex flex-col sm:flex-row justify-between gap-2">
          <p>© {new Date().getFullYear()} Home4U</p>
          <p>MVP · Scaffold</p>
        </div>
      </footer>
    </main>
  );
}

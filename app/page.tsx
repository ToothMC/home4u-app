import Link from "next/link";
import { ArrowRight, MessageCircle, KeyRound, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-5xl px-4 pt-16 pb-10 sm:pt-24 sm:pb-16 text-center">
        <p className="text-sm uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
          Home4U · Limassol
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
          <Button asChild size="lg">
            <Link href="/chat">
              <MessageCircle className="mr-1" />
              Mit Sophie chatten
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#pfade">So funktioniert&apos;s</Link>
          </Button>
        </div>
      </section>

      <section id="pfade" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-2xl sm:text-3xl font-semibold mb-8 text-center">
          Drei Wege zu Home4U
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <MessageCircle className="size-6 mb-2" />
              <CardTitle>Ich suche</CardTitle>
              <CardDescription>
                Erzähl Sophie in fünf Minuten, was du brauchst. Sie meldet sich,
                sobald sie passende Wohnungen findet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/chat?flow=seeker">Suche starten</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <KeyRound className="size-6 mb-2" />
              <CardTitle>Ich vermiete privat</CardTitle>
              <CardDescription>
                Wohnung online in unter 10 Minuten. KI-Preisempfehlung,
                mehrsprachige Texte, qualifizierte Interessenten.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/chat?flow=owner">Inserat erstellen</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Building2 className="size-6 mb-2" />
              <CardTitle>Ich bin Makler</CardTitle>
              <CardDescription>
                Beta-Zugang für die ersten 50 Partner — Bulk-Import,
                Lead-Scoring, mehrsprachige Inserate, kein Bait-and-Switch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/chat?flow=agent">Makler-Beirat</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
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
          <p>© {new Date().getFullYear()} Home4U · Limassol · Zypern</p>
          <p>MVP · Scaffold</p>
        </div>
      </footer>
    </main>
  );
}

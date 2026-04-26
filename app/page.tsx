import { Suspense } from "react";
import { ArrowRight, MessageCircle, ShieldCheck, Languages, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatLink, PathCards } from "@/components/landing/PathCards";
import { RegionPicker } from "@/components/landing/RegionPicker";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup, Logo } from "@/components/brand/Logo";

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <BrandLockup />
          <AuthMenu />
        </div>
      </header>

      {/* Hero */}
      <section className="relative bg-warm-hero overflow-hidden">
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-16 sm:pt-20 sm:pb-24 text-center relative">
          <div className="mx-auto mb-8 inline-flex">
            <Logo variant="stacked" width={120} priority />
          </div>
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--brand-gold-700)] font-medium mb-4">
            Dein Zuhause auf Zypern
          </p>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight mb-6 text-[var(--brand-navy)]">
            Schreib Sophie.
            <br />
            <span className="text-[var(--brand-gold)]">
              Sie findet dein Zuhause.
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-base sm:text-lg text-[var(--warm-bark)] mb-10 leading-relaxed">
            KI-gestützte Immobilienplattform mit Double-Match-Prinzip.
            Kein Kontakt-Chaos, keine Scam-Köder — nur Angebote, die wirklich passen.
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
              <Button asChild size="lg" className="bg-[var(--brand-navy)] hover:bg-[var(--brand-navy-700)] text-white shadow-[0_8px_24px_-8px_rgb(26_46_68/40%)]">
                <ChatLink>
                  <MessageCircle className="mr-1" />
                  Mit Sophie chatten
                  <ArrowRight />
                </ChatLink>
              </Button>
            </Suspense>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-[var(--brand-gold)] text-[var(--brand-gold-700)] hover:bg-[var(--brand-gold-50)]"
            >
              <a href="#region">
                <MapPin className="mr-1" />
                Region wählen
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Region Picker */}
      <section id="region" className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <Suspense
          fallback={
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
              Region lädt …
            </div>
          }
        >
          <RegionPicker />
        </Suspense>
      </section>

      {/* Drei Wege */}
      <section id="pfade" className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--brand-gold-700)] font-medium mb-2">
            So funktioniert&apos;s
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold text-[var(--brand-navy)]">
            Drei Wege zu Home4U
          </h2>
        </div>
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

      {/* Double-Match */}
      <section className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <div className="rounded-2xl bg-warm-gradient border border-[var(--brand-gold-100)] p-6 sm:p-12 shadow-[0_14px_40px_-10px_rgb(120_90_50/12%)]">
          <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-start">
            <div className="size-14 rounded-2xl bg-[var(--brand-navy)] flex items-center justify-center shrink-0 shadow-[0_8px_24px_-6px_rgb(26_46_68/40%)]">
              <Sparkles className="size-7 text-[var(--brand-gold)]" />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl font-semibold mb-3 text-[var(--brand-navy)]">
                Warum Double-Match?
              </h3>
              <p className="text-[var(--warm-bark)] mb-5 leading-relaxed">
                Kontakt entsteht nur, wenn beide Seiten sich gegenseitig als passend
                markieren. Keine Kaltanfragen, keine Belästigung. Sophie verbindet
                euch erst, wenn&apos;s für beide passt.
              </p>
              <ul className="grid sm:grid-cols-2 gap-3 text-sm text-[var(--warm-bark)]">
                <Feature icon={<ShieldCheck className="size-4 text-[var(--brand-gold)]" />}>
                  Echte Lokation Pflicht, Provisionshöhe vorab sichtbar
                </Feature>
                <Feature icon={<ShieldCheck className="size-4 text-[var(--brand-gold)]" />}>
                  14-Tage-Aktivitäts-Check — nichts Veraltetes
                </Feature>
                <Feature icon={<ShieldCheck className="size-4 text-[var(--brand-gold)]" />}>
                  KI-Bild-Check gegen Stockfotos und Duplikate
                </Feature>
                <Feature icon={<Languages className="size-4 text-[var(--brand-gold)]" />}>
                  Sophie spricht Deutsch, Englisch, Russisch, Griechisch
                </Feature>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-10 mt-4 border-t border-[var(--border)]">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-[var(--muted-foreground)]">
          <div className="flex items-center gap-3">
            <Logo variant="icon" width={28} />
            <span>© {new Date().getFullYear()} Home4U · Dein Zuhause auf Zypern</span>
          </div>
          <p className="opacity-70">MVP · made with care</p>
        </div>
      </footer>
    </main>
  );
}

function Feature({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

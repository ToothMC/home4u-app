import Image from "next/image";
import { Suspense } from "react";
import { ArrowRight, Target, Users, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatLink, PathCards } from "@/components/landing/PathCards";
import { RegionPicker } from "@/components/landing/RegionPicker";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* Header — minimal, viel Luft */}
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <BrandLockup iconSize={36} />
          <AuthMenu />
        </div>
      </header>

      {/* Hero — Bild rechts (Mediterrane Terrasse bei Sonnenuntergang),
          Headline links auf Cream mit weichem Übergang */}
      <section className="relative bg-[var(--warm-cream)] overflow-hidden">
        {/* Bild — auf Mobile als ruhiger Background hinter dem Text mit
            starkem Cream-Gradient; auf Desktop rechts ~58% breit */}
        <div className="absolute inset-0 sm:left-1/2">
          <Image
            src="/hero/villa-terrace-sunset.jpg"
            alt="Mediterrane Villa-Terrasse mit Meerblick bei Sonnenuntergang"
            fill
            priority
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
          {/* Cream-Verlauf: Mobile von oben, Desktop von links → schmale Übergangskante */}
          <div
            className="absolute inset-0 sm:hidden"
            style={{
              background:
                "linear-gradient(180deg, var(--warm-cream) 0%, rgb(247 245 241 / 88%) 30%, rgb(247 245 241 / 60%) 100%)",
            }}
          />
          <div
            className="absolute inset-0 hidden sm:block"
            style={{
              background:
                "linear-gradient(90deg, var(--warm-cream) 0%, rgb(247 245 241 / 80%) 12%, rgb(247 245 241 / 0%) 35%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-24 sm:pt-28 sm:pb-32 min-h-[560px] sm:min-h-[640px]">
          <div className="max-w-xl sm:max-w-lg">
            <h1 className="font-display text-5xl sm:text-7xl leading-[1.05] text-[var(--brand-navy)]">
              Hier finde ich
              <br />
              mein <span className="text-[var(--brand-gold)]">Zuhause.</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-[var(--warm-bark)] leading-relaxed max-w-md">
              Home4U verbindet dich mit passenden Immobilien — persönlich,
              einfach und modern.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Suspense
                fallback={
                  <Button size="lg" disabled>
                    Jetzt starten
                  </Button>
                }
              >
                <Button asChild size="lg">
                  <ChatLink>
                    Jetzt starten
                    <ArrowRight />
                  </ChatLink>
                </Button>
              </Suspense>
              <Button asChild size="lg" variant="outline" className="bg-white/85 backdrop-blur">
                <a href="#region">Immobilien entdecken</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Region-Suche — schlanker, weißes Card auf Cream */}
      <section id="region" className="mx-auto max-w-6xl px-6 -mt-8 relative z-10">
        <Suspense
          fallback={
            <div className="rounded-2xl bg-white border border-[var(--border)] p-6 text-sm text-[var(--muted-foreground)] shadow-[0_10px_30px_-12px_rgb(26_46_68/12%)]">
              Region lädt …
            </div>
          }
        >
          <RegionPicker />
        </Suspense>
      </section>

      {/* "Warum Home4U?" — drei stille Spalten, kein Gold-Wash */}
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <h2 className="font-display text-3xl sm:text-4xl text-center text-[var(--brand-navy)] mb-12 sm:mb-16">
          Warum Home4U?
        </h2>
        <div className="grid sm:grid-cols-3 gap-10 sm:gap-12">
          <Pillar
            icon={<Target className="size-5" />}
            title="Passende Angebote statt endlos suchen"
            text="Unsere Technologie und unser Netzwerk zeigen dir nur Immobilien, die wirklich zu dir passen."
          />
          <Pillar
            icon={<Users className="size-5" />}
            title="Direkt & persönlich"
            text="Kontaktiere Eigentümer und geprüfte Makler direkt — ohne Umwege und mit voller Transparenz."
          />
          <Pillar
            icon={<HomeIcon className="size-5" />}
            title="Zuhause-Gefühl"
            text="Wir verstehen, dass es um mehr geht als Daten. Wir helfen dir, das richtige Zuhause zu finden."
          />
        </div>
      </section>

      {/* Drei Wege */}
      <section id="pfade" className="mx-auto max-w-6xl px-6 pb-16 sm:pb-24">
        <h2 className="font-display text-3xl sm:text-4xl text-center text-[var(--brand-navy)] mb-10">
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

      {/* Closing-Block */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-2xl bg-white border border-[var(--border)] p-8 sm:p-14">
          <h3 className="font-display text-3xl sm:text-4xl text-[var(--brand-navy)] leading-tight">
            Bereit, dein Zuhause<br className="hidden sm:block" />
            in Zypern zu finden?
          </h3>
          <p className="mt-4 max-w-xl text-[var(--warm-bark)]">
            Lass uns gemeinsam den richtigen Ort für dich finden. Persönlich.
            Einfach. Home4U.
          </p>
          <div className="mt-8">
            <Suspense fallback={<Button size="lg" disabled>Jetzt starten</Button>}>
              <Button asChild size="lg">
                <ChatLink>
                  Jetzt starten
                  <ArrowRight />
                </ChatLink>
              </Button>
            </Suspense>
          </div>
        </div>
      </section>

      {/* Footer — kompakt, nüchtern */}
      <footer className="bg-[var(--brand-navy)] text-white/80">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row gap-6 sm:items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-white">
              Home<span className="text-[var(--brand-gold)]">4</span>U
            </span>
            <span className="text-white/50">·</span>
            <span className="text-white/60">
              © {new Date().getFullYear()} Dein Zuhause auf Zypern
            </span>
          </div>
          <div className="flex items-center gap-6 text-white/60 text-xs">
            <a href="#region" className="hover:text-white">Entdecken</a>
            <a href="#pfade" className="hover:text-white">Drei Wege</a>
            <span>MVP</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Pillar({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div>
      <div className="size-12 rounded-full bg-[var(--muted)] text-[var(--brand-gold-700)] flex items-center justify-center mb-5">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--brand-navy)] mb-2 leading-snug">
        {title}
      </h3>
      <p className="text-sm text-[var(--warm-bark)] leading-relaxed">{text}</p>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Heart, Target, Users, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatLink, PathCards } from "@/components/landing/PathCards";
import { RegionPicker } from "@/components/landing/RegionPicker";
import { FeaturedListings } from "@/components/landing/FeaturedListings";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* Header — minimal, viel Luft, mobile = nur Logo+Auth */}
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between gap-4">
          <BrandLockup iconSize={36} />
          <nav className="hidden lg:flex items-center gap-7 text-sm text-[var(--brand-navy)]">
            <a href="#region" className="hover:text-[var(--brand-gold)] transition-colors">Entdecken</a>
            <Link href="/chat?flow=owner" className="hover:text-[var(--brand-gold)] transition-colors">Vermieten</Link>
            <Link href="/chat?flow=owner&intent=sale" className="hover:text-[var(--brand-gold)] transition-colors">Verkaufen</Link>
            <Link href="/chat?flow=agent" className="hover:text-[var(--brand-gold)] transition-colors">Für Makler</Link>
            <a href="#warum" className="hover:text-[var(--brand-gold)] transition-colors">Über uns</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/matches"
              aria-label="Meine Favoriten"
              className="hidden sm:inline-flex size-9 items-center justify-center rounded-full text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)] hover:text-[var(--brand-gold)] transition-colors"
            >
              <Heart className="size-5" />
            </Link>
            <AuthMenu />
          </div>
        </div>
      </header>

      {/* Hero — full-bleed Bild über die ganze Seite, Text links mit
          weichem Cream-Verlauf für Lesbarkeit */}
      <section className="relative bg-[var(--warm-cream)] overflow-hidden">
        {/* Bild full bleed */}
        <div className="absolute inset-0">
          <Image
            src="/hero/home4u-hero.png"
            alt="Moderne Villa-Terrasse mit Meerblick"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center sm:object-right"
          />
          {/* Cream-Verlauf für lesbaren Text */}
          <div
            className="absolute inset-0 sm:hidden"
            style={{
              background:
                "linear-gradient(180deg, rgb(247 245 241 / 92%) 0%, rgb(247 245 241 / 75%) 35%, rgb(247 245 241 / 30%) 70%, transparent 100%)",
            }}
          />
          <div
            className="absolute inset-0 hidden sm:block"
            style={{
              background:
                "linear-gradient(90deg, rgb(247 245 241 / 92%) 0%, rgb(247 245 241 / 78%) 28%, rgb(247 245 241 / 30%) 55%, transparent 75%)",
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
      <section id="warum" className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
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

      {/* Ausgewählte Immobilien — echte Daten */}
      <Suspense fallback={null}>
        <FeaturedListings />
      </Suspense>

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

      {/* Closing-Block — full bleed, Bild links bis zum Rand, Text rechts */}
      <section className="relative bg-[var(--warm-cream)] overflow-hidden">
        {/* Bild — Mobile: oben full width; Desktop: linke Hälfte bis zum Bildschirmrand */}
        <div className="absolute inset-x-0 top-0 h-72 sm:inset-y-0 sm:right-1/2 sm:h-auto sm:left-0">
          <Image
            src="/hero/home4u-hero-sunset.png"
            alt="Paar auf Terrasse beim Sonnenuntergang"
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
          {/* Cream-Übergang am Mobile-Rand bzw. rechten Bildrand auf Desktop */}
          <div
            className="absolute inset-0 sm:hidden"
            style={{
              background:
                "linear-gradient(180deg, transparent 60%, rgb(247 245 241 / 70%) 90%, var(--warm-cream) 100%)",
            }}
          />
          <div
            className="absolute inset-0 hidden sm:block"
            style={{
              background:
                "linear-gradient(270deg, var(--warm-cream) 0%, rgb(247 245 241 / 70%) 12%, rgb(247 245 241 / 0%) 35%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-72 pb-20 sm:pt-24 sm:pb-28 min-h-[480px]">
          <div className="sm:ml-[55%] sm:max-w-md">
            <h3 className="font-display text-3xl sm:text-4xl text-[var(--brand-navy)] leading-tight">
              Bereit, dein Zuhause<br className="hidden sm:block" />
              in Zypern zu finden?
            </h3>
            <p className="mt-4 text-[var(--warm-bark)] leading-relaxed">
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
        </div>
      </section>

      {/* Stats-Strip + Footer-Mini auf Navy */}
      <StatsStrip />
      <footer className="bg-[var(--brand-navy)] text-white/60 border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-white">
              Home<span className="text-[var(--brand-gold)]">4</span>U
            </span>
            <span className="text-white/30">·</span>
            <span>© {new Date().getFullYear()} Dein Zuhause auf Zypern</span>
          </div>
          <div className="flex items-center gap-5 text-white/50">
            <a href="#region" className="hover:text-white">Entdecken</a>
            <a href="#pfade" className="hover:text-white">Drei Wege</a>
            <a href="#warum" className="hover:text-white">Über uns</a>
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

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Heart, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatLink, PathCards } from "@/components/landing/PathCards";
import { FeaturedListings } from "@/components/landing/FeaturedListings";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import { LanguageFlagPicker } from "@/components/lang/LanguageFlagPicker";
import { getT } from "@/lib/i18n/server";

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const { t, lang } = await getT();
  return (
    <main className="flex-1">
      {/* Header — minimal, viel Luft, mobile = nur Logo+Auth */}
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3.5 flex items-center justify-between gap-2 sm:gap-4">
          <BrandLockup iconSize={36} />
          <nav className="hidden lg:flex items-center gap-7 text-sm text-[var(--brand-navy)]">
            <ChatLink flow="seeker" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.search")}</ChatLink>
            <Link href="/chat?flow=owner" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.rentOut")}</Link>
            <Link href="/chat?flow=owner&intent=sale" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.sell")}</Link>
            <Link href="/gesuche" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.wantedAds")}</Link>
            <Link href="/chat?flow=agent" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.forAgents")}</Link>
            <Link href="/scam-check" className="hover:text-[var(--brand-gold)] transition-colors">{t("nav.scamCheck")}</Link>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageFlagPicker
              initial={lang}
              labels={{ title: t("lang.label"), choose: t("lang.choose") }}
            />
            <Link
              href="/dashboard/bookmarks"
              aria-label={t("nav.favorites")}
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
            alt={t("hero.image.alt")}
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
              {t("hero.title.line1")}
              <br />
              {t("hero.title.line2.prefix")}{" "}
              <span className="text-[var(--brand-gold)]">{t("hero.title.line2.accent")}</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-[var(--warm-bark)] leading-relaxed max-w-md">
              {t("hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Suspense
                fallback={
                  <Button size="lg" disabled>
                    {t("hero.cta.search")}
                  </Button>
                }
              >
                <Button asChild size="lg">
                  <ChatLink>
                    {t("hero.cta.search")}
                    <ArrowRight />
                  </ChatLink>
                </Button>
              </Suspense>
              <Button asChild size="lg" variant="outline" className="bg-white/85 backdrop-blur">
                <Link href="/scam-check">{t("hero.cta.check")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* "Warum Home4U?" — drei stille Spalten, kein Gold-Wash */}
      <section id="warum" className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <h2 className="font-display text-3xl sm:text-4xl text-center text-[var(--brand-navy)] mb-12 sm:mb-16">
          {t("why.heading")}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-12">
          <Pillar
            badge={
              <span className="inline-flex rounded-full bg-white border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold leading-none text-emerald-700">
                {t("why.match.badge")}
              </span>
            }
            title={t("why.match.title")}
            text={t("why.match.text")}
          />
          <Pillar
            badge={
              <span className="inline-flex items-center gap-1 rounded-full bg-white border border-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-emerald-700">
                <span className="inline-block size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {t("why.scam.badge")}
              </span>
            }
            title={t("why.scam.title")}
            text={t("why.scam.text")}
          />
          <Pillar
            badge={
              <span
                className="inline-flex items-center gap-1 rounded-full bg-white border border-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-emerald-700"
                aria-label={t("why.price.aria")}
              >
                <span className="inline-flex items-end gap-[1px]" aria-hidden>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      className="w-[2px] rounded-sm bg-emerald-500"
                      style={{ height: `${4 + i * 1.5}px` }}
                    />
                  ))}
                </span>
                {t("why.price.badge")}
              </span>
            }
            title={t("why.price.title")}
            text={t("why.price.text")}
          />
          <Pillar
            badge={
              <span className="inline-flex items-center gap-1 rounded-full bg-white border border-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-emerald-700">
                <Lock className="size-3" aria-hidden />
                {t("why.anon.badge")}
              </span>
            }
            title={t("why.anon.title")}
            text={t("why.anon.text")}
            cta={{ href: "/gesuche", label: t("why.anon.cta") }}
          />
        </div>
      </section>

      {/* Ausgewählte Immobilien — echte Daten */}
      <Suspense fallback={null}>
        <FeaturedListings regionSlug={sp.region ?? null} />
      </Suspense>

      {/* Vier Wege */}
      <section id="pfade" className="mx-auto max-w-6xl px-6 pb-16 sm:pb-24">
        <h2 className="font-display text-3xl sm:text-4xl text-center text-[var(--brand-navy)] mb-10">
          {t("paths.heading")}
        </h2>
        <Suspense
          fallback={
            <div className="text-center text-sm text-[var(--muted-foreground)]">
              {t("common.loading")}
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
            alt={t("closing.image.alt")}
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
              {t("closing.heading")}
            </h3>
            <p className="mt-4 text-[var(--warm-bark)] leading-relaxed">
              {t("closing.text")}
            </p>
            <div className="mt-8">
              <Suspense fallback={<Button size="lg" disabled>{t("hero.cta.search")}</Button>}>
                <Button asChild size="lg">
                  <ChatLink>
                    {t("hero.cta.search")}
                    <ArrowRight />
                  </ChatLink>
                </Button>
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* Stats-Strip + Footer-Mini auf Navy */}
      <Suspense fallback={null}>
        <StatsStrip />
      </Suspense>
      <footer className="bg-[var(--brand-navy)] text-white/60 border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-white">
              Home<span className="text-[var(--brand-gold)]">4</span>U
            </span>
            <span className="text-white/30">·</span>
            <span>© {new Date().getFullYear()} {t("footer.tagline")}</span>
          </div>
          <div className="flex items-center gap-5 text-white/50">
            <ChatLink flow="seeker" className="hover:text-white">{t("nav.search")}</ChatLink>
            <Link href="/gesuche" className="hover:text-white">{t("nav.wantedAds")}</Link>
            <a href="#pfade" className="hover:text-white">{t("footer.fourPaths")}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Pillar({
  badge,
  title,
  text,
  cta,
}: {
  badge: React.ReactNode;
  title: string;
  text: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div>
      <div className="mb-5 flex h-12 items-center">{badge}</div>
      <h3 className="text-lg font-semibold text-[var(--brand-navy)] mb-2 leading-snug">
        {title}
      </h3>
      <p className="text-sm text-[var(--warm-bark)] leading-relaxed">{text}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-3 inline-block text-sm font-medium text-[var(--brand-navy)] hover:text-[var(--brand-gold)] transition-colors"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

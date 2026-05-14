import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum / Legal Notice — Home4U",
  description: "Impressum und rechtliche Angaben von Home4U.",
  alternates: { canonical: "/impressum" },
  robots: { index: true, follow: true },
};

export default function ImpressumPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] py-12 px-4">
      <article className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 text-sm text-[var(--muted-foreground)]">
          <a href="/" className="hover:underline">home4u.ai</a>
          <div className="flex gap-3">
            <a href="#de" className="hover:underline">DE</a>
            <a href="#en" className="hover:underline">EN</a>
          </div>
        </div>

        {/* ===================== DE ===================== */}
        <section id="de" className="scroll-mt-24 mb-12">
          <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)] mb-2">
            Impressum
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">Stand: 14.05.2026</p>

          <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-6 space-y-6">
            <Block title="Angaben zum Anbieter">
              <strong>M+M Hammer Ltd</strong>
              <br />
              Akoursos 30A
              <br />
              8560 Pegeia / Paphos
              <br />
              Cyprus
            </Block>

            <Block title="Registerangaben">
              Company Registration No.: <strong>HE424634</strong>
              <br />
              VAT ID: <strong>CY 10424634L</strong>
            </Block>

            <Block title="Vertretungsberechtigt">
              Director: <strong>Michael Hammer</strong>
            </Block>

            <Block title="Kontakt">
              E-Mail:{" "}
              <a className="underline" href="mailto:info@mmhammer.org">
                info@mmhammer.org
              </a>
            </Block>

            <Block title="Verantwortlich für den Inhalt">
              Michael Hammer
              <br />
              (Adresse wie oben)
            </Block>

            <p className="text-sm text-[var(--muted-foreground)] pt-2">
              Hinweis: Home4U ist eine KI-gestützte Immobilienplattform und ersetzt keine
              individuelle Rechts-, Steuer- oder Anlageberatung.
            </p>
          </div>
        </section>

        <hr className="my-10 border-[var(--border)]" />

        {/* ===================== EN ===================== */}
        <section id="en" className="scroll-mt-24">
          <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)] mb-2">
            Legal Notice
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">Effective date: 2026-05-14</p>

          <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-6 space-y-6">
            <Block title="Provider information">
              <strong>M+M Hammer Ltd</strong>
              <br />
              Akoursos 30A
              <br />
              8560 Pegeia / Paphos
              <br />
              Cyprus
            </Block>

            <Block title="Registration">
              Company Registration No.: <strong>HE424634</strong>
              <br />
              VAT ID: <strong>CY 10424634L</strong>
            </Block>

            <Block title="Represented by">
              Director: <strong>Michael Hammer</strong>
            </Block>

            <Block title="Contact">
              Email:{" "}
              <a className="underline" href="mailto:info@mmhammer.org">
                info@mmhammer.org
              </a>
            </Block>

            <Block title="Content responsibility">
              Michael Hammer
              <br />
              (address as above)
            </Block>

            <p className="text-sm text-[var(--muted-foreground)] pt-2">
              Note: Home4U is an AI-powered real-estate platform and does not provide individual
              legal, tax, or investment advice.
            </p>
          </div>
        </section>

        <div className="mt-12 text-center text-xs text-[var(--muted-foreground)]">
          <a href="/impressum" className="hover:underline mx-2">Impressum</a>
          <a href="/datenschutz" className="hover:underline mx-2">Datenschutz</a>
          <div className="mt-2">© {new Date().getFullYear()} M+M Hammer Ltd</div>
        </div>
      </article>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-[var(--brand-navy)] mb-2">{title}</h2>
      <div className="text-[var(--foreground)] leading-relaxed">{children}</div>
    </div>
  );
}

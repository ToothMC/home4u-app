import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Datenschutz / Privacy — Home4U",
  description: "Datenschutzerklärung von Home4U — wie wir mit deinen Daten umgehen.",
  alternates: { canonical: "/datenschutz" },
  robots: { index: true, follow: true },
};

export default function DatenschutzPage() {
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
            Datenschutzerklärung
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">Stand: 14.05.2026</p>

          <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-6 space-y-6 leading-relaxed">
            <Section title="1. Verantwortlicher">
              <p>
                M+M Hammer Ltd
                <br />
                Akoursos 30A, 8560 Pegeia / Paphos, Cyprus
                <br />
                E-Mail:{" "}
                <a className="underline" href="mailto:info@mmhammer.org">
                  info@mmhammer.org
                </a>
              </p>
            </Section>

            <Section title="2. Worum geht es bei Home4U?">
              <p>
                Home4U ist eine KI-gestützte Immobilienplattform für Zypern. Sophie, unsere
                KI-Assistentin, chattet mit dir, versteht deine Wünsche und findet passende
                Immobilien-Angebote oder Wohnungssuchende (&bdquo;Double-Match&ldquo;-Prinzip).
                Bei Nutzung des Services werden personenbezogene Daten verarbeitet, um den
                Service bereitzustellen, zu betreiben, abzusichern und zu verbessern.
              </p>
            </Section>

            <Section title="3. Welche Daten verarbeiten wir?">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Account- und Profildaten</strong> (z.&nbsp;B. E-Mail, Name, Sprache,
                  Such-Präferenzen)
                </li>
                <li>
                  <strong>Such- und Gesuchsdaten</strong> (deine Wünsche an Lage, Budget, Typ,
                  Zeitraum; gespeicherte Suchen und Gesuche)
                </li>
                <li>
                  <strong>Chat-Inhalte</strong> (Konversationen mit Sophie über Web oder
                  Telegram)
                </li>
                <li>
                  <strong>Inserats- und Bookmark-Daten</strong> (Listings, die du erstellst oder
                  speicherst, Anfragen an Inserenten)
                </li>
                <li>
                  <strong>Telegram-Kennungen</strong> (tg_user_id, Sprachpräferenz, sofern du den
                  Telegram-Bot nutzt)
                </li>
                <li>
                  <strong>Scam-Check-Daten</strong> (zur Analyse eingereichte Inhalte; siehe
                  Abschnitt 7)
                </li>
                <li>
                  <strong>Kontaktdaten von Inserenten</strong> (Telefonnummern und E-Mails werden
                  gepeppert/gehasht gespeichert, um Duplikate zu erkennen und Missbrauch
                  vorzubeugen — nicht im Klartext)
                </li>
                <li>
                  <strong>Nutzungs-/Logdaten</strong> (Session-Dauer, technische Logs,
                  IP-Adressen)
                </li>
                <li>
                  <strong>Geräte-/Verbindungsdaten</strong> (Browser-Infos zur Sicherheit und
                  Fehleranalyse)
                </li>
              </ul>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Hinweis: Bitte teile keine sensiblen Informationen (z.&nbsp;B. Gesundheitsdaten,
                Ausweisdaten), wenn du nicht möchtest, dass sie verarbeitet und ggf. gespeichert
                werden.
              </p>
            </Section>

            <Section title="4. Zwecke und Rechtsgrundlagen">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Bereitstellung des Services</strong> (Art. 6 Abs. 1 lit. b
                  DSGVO &ndash; Vertrag/Anbahnung)
                </li>
                <li>
                  <strong>Matching von Suchen und Inseraten</strong> (Art. 6 Abs. 1 lit. b
                  DSGVO &ndash; Bestandteil der Leistung)
                </li>
                <li>
                  <strong>Sicherheit, Missbrauchs- und Betrugsprävention</strong> (Art. 6 Abs. 1
                  lit. f DSGVO &ndash; berechtigtes Interesse)
                </li>
                <li>
                  <strong>Reichweiten-Analyse mit Plausible</strong> (Art. 6 Abs. 1 lit. f
                  DSGVO &ndash; berechtigtes Interesse; cookielose Statistik)
                </li>
                <li>
                  <strong>Fehleranalyse und Stabilität</strong> (Art. 6 Abs. 1 lit. f DSGVO)
                </li>
                <li>
                  <strong>Rechtliche Pflichten</strong> (Art. 6 Abs. 1 lit. c DSGVO)
                </li>
              </ul>
            </Section>

            <Section title="5. Empfänger / Dienstleister (Auftragsverarbeitung)">
              <p>Wir setzen folgende Dienstleister als Auftragsverarbeiter ein:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  <strong>Supabase</strong> &mdash; Datenbank, Authentifizierung und primäre
                  Datenhaltung.
                </li>
                <li>
                  <strong>Vercel</strong> &mdash; Hosting und Content Delivery (CDN/Edge), Logs.
                </li>
                <li>
                  <strong>OpenAI</strong> &mdash; KI-Modelle für Sophie&apos;s Sprachverarbeitung
                  und Verständnis deiner Wünsche.
                </li>
                <li>
                  <strong>Anthropic (Claude)</strong> &mdash; KI-Modelle für Analyse und
                  Listing-Verarbeitung.
                </li>
                <li>
                  <strong>Google (Gemini)</strong> &mdash; KI-Modelle für schnelle Antworten und
                  multimodale Verarbeitung.
                </li>
                <li>
                  <strong>Telegram</strong> &mdash; sofern du den Telegram-Bot nutzt, ist Telegram
                  Übertragungskanal für die Konversation.
                </li>
                <li>
                  <strong>Plausible Analytics</strong> &mdash; cookielose, datenschutzfreundliche
                  Reichweiten-Analyse (EU-Hosting).
                </li>
              </ul>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Mit allen Anbietern bestehen vertragliche Regelungen zur Datenverarbeitung
                (DPAs/AVV).
              </p>
            </Section>

            <Section title="6. Datenstandort und Drittlandübermittlung">
              <p>
                Die primäre Datenhaltung (Datenbank, Nutzerkonten, Suchen, Gesuche) erfolgt bei
                Supabase. Je nach genutztem KI-Anbieter und Dienst können Inhalte zur
                Verarbeitung an Server in den USA oder anderen Drittländern übermittelt werden
                (insbesondere OpenAI, Anthropic, Google, Vercel). In diesen Fällen stützen wir
                uns auf geeignete Garantien, insbesondere{" "}
                <strong>Standardvertragsklauseln (SCCs)</strong> und/oder einen anerkannten
                Angemessenheitsbeschluss (z.&nbsp;B. EU&ndash;US Data Privacy Framework).
              </p>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Deine Daten werden nicht für das Training von KI-Modellen verwendet.
              </p>
            </Section>

            <Section title="7. Scam-Shield" id="scam-shield">
              <p>
                Mit dem Scam-Shield kannst du verdächtige Inserate, Nachrichten oder Anrufe
                prüfen lassen. Dabei verarbeiten wir:
              </p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  <strong>Eingereichten Inhalt</strong> (Text, Screenshot, Telefonnummer) zur
                  KI-gestützten Analyse.
                </li>
                <li>
                  <strong>Gepfefferte Hashes von Telefonnummern und E-Mails</strong>, um
                  bekannte Scam-Indikatoren wiederzuerkennen. Originaldaten werden nicht im
                  Klartext gespeichert.
                </li>
                <li>
                  <strong>Aggregierte Scam-Reports</strong>, um die Community vor wiederkehrenden
                  Mustern zu schützen.
                </li>
              </ul>
              <p className="text-sm bg-[var(--brand-gold-50)] p-3 rounded mt-3">
                Hinweis: Die Scam-Analyse ist eine Einschätzung der KI &mdash; sie ersetzt
                keine eigene Sorgfalt und ist keine juristisch verbindliche Aussage.
              </p>
            </Section>

            <Section title="8. Speicherdauer">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Account-/Profildaten:</strong> bis zur Löschung deines Accounts,
                  sofern keine gesetzlichen Pflichten entgegenstehen
                </li>
                <li>
                  <strong>Suchen / Gesuche / Bookmarks:</strong> bis du sie löschst oder dein
                  Konto löschst
                </li>
                <li>
                  <strong>Chat-Inhalte:</strong> für die Dauer der Konversation und zur
                  Verbesserung künftiger Antworten; Löschung auf Anfrage
                </li>
                <li>
                  <strong>Inserate:</strong> bis du sie löschst oder ihre Gültigkeit abläuft
                </li>
                <li>
                  <strong>Logdaten:</strong> so lange wie nötig für Sicherheit/Fehleranalyse,
                  danach Löschung/Anonymisierung
                </li>
                <li>
                  <strong>Hashes (Phone/E-Mail Pepper):</strong> dauerhaft, da nicht
                  rückrechenbar
                </li>
              </ul>
            </Section>

            <Section title="9. Deine Rechte">
              <p>
                Du hast &mdash; soweit die DSGVO anwendbar ist &mdash; insbesondere folgende
                Rechte:
              </p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Auskunft, Berichtigung, Löschung</li>
                <li>Einschränkung der Verarbeitung</li>
                <li>Datenübertragbarkeit</li>
                <li>Widerspruch gegen Verarbeitung auf Basis berechtigter Interessen</li>
                <li>
                  Beschwerde bei einer Datenschutzaufsichtsbehörde (in Zypern: Office of the
                  Commissioner for Personal Data Protection)
                </li>
              </ul>
              <p className="mt-2">
                Anfragen bitte an:{" "}
                <a className="underline" href="mailto:info@mmhammer.org">
                  info@mmhammer.org
                </a>
              </p>
            </Section>

            <Section title="10. Cookies / Local Storage">
              <p>
                Wir verwenden technisch notwendige Cookies bzw. Local Storage für Login,
                Sessions, Sprache und Sicherheit. Für die Reichweiten-Analyse setzen wir{" "}
                <strong>Plausible Analytics</strong> ein &mdash; cookielos, ohne Tracking
                einzelner Nutzer, ohne Übermittlung in Drittländer. Sofern wir künftig
                weitergehende Analyse- oder Marketing-Tools einsetzen, ergänzen wir dies hier
                (inkl. Einwilligung, falls erforderlich).
              </p>
            </Section>

            <Section title="11. Minderjährige">
              <p>
                Der Service richtet sich nicht an Kinder. Wenn du unter 18 bist, nutze Home4U
                bitte nicht ohne Einverständnis eines Erziehungsberechtigten.
              </p>
            </Section>

            <Section title="12. Kein Profiling mit Rechtswirkung">
              <p>
                Wir treffen keine ausschließlich automatisierten Entscheidungen, die dir
                gegenüber eine rechtliche Wirkung entfalten oder dich in ähnlicher Weise
                erheblich beeinträchtigen (Art. 22 DSGVO), soweit nicht ausdrücklich anders
                angegeben.
              </p>
            </Section>
          </div>
        </section>

        <hr className="my-10 border-[var(--border)]" />

        {/* ===================== EN ===================== */}
        <section id="en" className="scroll-mt-24">
          <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)] mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">Effective date: 2026-05-14</p>

          <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-6 space-y-6 leading-relaxed">
            <Section title="1. Controller">
              <p>
                M+M Hammer Ltd
                <br />
                Akoursos 30A, 8560 Pegeia / Paphos, Cyprus
                <br />
                Email:{" "}
                <a className="underline" href="mailto:info@mmhammer.org">
                  info@mmhammer.org
                </a>
              </p>
            </Section>

            <Section title="2. What is Home4U?">
              <p>
                Home4U is an AI-powered real-estate platform for Cyprus. Sophie, our AI
                assistant, chats with you, understands your needs and finds matching properties
                or potential tenants/buyers (&ldquo;double match&rdquo; principle). When you use
                the service, we process personal data to provide, operate, secure, and improve
                the service.
              </p>
            </Section>

            <Section title="3. Data we process">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Account & profile data</strong> (e.g., email, name, language, search
                  preferences)
                </li>
                <li>
                  <strong>Searches & wanted-ad data</strong> (location, budget, type, time
                  frame; saved searches and wanted-ads)
                </li>
                <li>
                  <strong>Chat content</strong> (conversations with Sophie via Web or Telegram)
                </li>
                <li>
                  <strong>Listing & bookmark data</strong> (listings you create or save,
                  inquiries to advertisers)
                </li>
                <li>
                  <strong>Telegram identifiers</strong> (tg_user_id, language preference, if you
                  use the Telegram bot)
                </li>
                <li>
                  <strong>Scam-check data</strong> (content submitted for analysis; see
                  section 7)
                </li>
                <li>
                  <strong>Advertiser contact data</strong> (phone numbers and emails are stored
                  peppered/hashed for duplicate detection and abuse prevention &mdash; not in
                  clear text)
                </li>
                <li>
                  <strong>Usage / log data</strong> (session duration, technical logs, IP
                  addresses)
                </li>
                <li>
                  <strong>Device / connection data</strong> (browser details for security and
                  debugging)
                </li>
              </ul>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Please avoid sharing sensitive information (e.g., health data, IDs) if you do
                not want it processed and potentially stored.
              </p>
            </Section>

            <Section title="4. Purposes and legal bases">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Providing the service</strong> (GDPR Art. 6(1)(b) &ndash;
                  contract/pre-contract)
                </li>
                <li>
                  <strong>Matching of searches and listings</strong> (GDPR Art. 6(1)(b) &ndash;
                  part of the service)
                </li>
                <li>
                  <strong>Security and fraud/misuse prevention</strong> (GDPR Art. 6(1)(f)
                  &ndash; legitimate interests)
                </li>
                <li>
                  <strong>Audience analytics via Plausible</strong> (GDPR Art. 6(1)(f) &ndash;
                  cookieless statistics)
                </li>
                <li>
                  <strong>Debugging and stability</strong> (GDPR Art. 6(1)(f))
                </li>
                <li>
                  <strong>Legal obligations</strong> (GDPR Art. 6(1)(c))
                </li>
              </ul>
            </Section>

            <Section title="5. Processors / service providers">
              <p>We use the following service providers as processors:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  <strong>Supabase</strong> &mdash; database, authentication, primary data
                  storage.
                </li>
                <li>
                  <strong>Vercel</strong> &mdash; hosting and content delivery (CDN/Edge), logs.
                </li>
                <li>
                  <strong>OpenAI</strong> &mdash; AI models for Sophie&apos;s language
                  processing.
                </li>
                <li>
                  <strong>Anthropic (Claude)</strong> &mdash; AI models for analysis and listing
                  processing.
                </li>
                <li>
                  <strong>Google (Gemini)</strong> &mdash; AI models for fast answers and
                  multimodal processing.
                </li>
                <li>
                  <strong>Telegram</strong> &mdash; if you use the Telegram bot, Telegram is the
                  conversation transport.
                </li>
                <li>
                  <strong>Plausible Analytics</strong> &mdash; cookieless, privacy-friendly
                  audience analytics (EU-hosted).
                </li>
              </ul>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                All providers are bound by data processing agreements (DPAs).
              </p>
            </Section>

            <Section title="6. Data location and international transfers">
              <p>
                Primary data storage (database, user accounts, searches, wanted-ads) is at
                Supabase. Depending on the AI provider and service used, content may be
                transmitted to servers in the US or other third countries for processing
                (notably OpenAI, Anthropic, Google, Vercel). Where applicable, we rely on
                appropriate safeguards such as{" "}
                <strong>Standard Contractual Clauses (SCCs)</strong> and/or adequacy mechanisms
                (e.g., EU&ndash;US Data Privacy Framework).
              </p>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Your data is not used for training AI models.
              </p>
            </Section>

            <Section title="7. Scam-Shield">
              <p>
                Scam-Shield lets you check suspicious listings, messages or calls. We process:
              </p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  <strong>Submitted content</strong> (text, screenshot, phone number) for
                  AI-assisted analysis.
                </li>
                <li>
                  <strong>Peppered hashes of phone numbers and emails</strong> to recognize
                  known scam indicators. Originals are not stored in clear text.
                </li>
                <li>
                  <strong>Aggregated scam reports</strong> to protect the community from
                  recurring patterns.
                </li>
              </ul>
              <p className="text-sm bg-[var(--brand-gold-50)] p-3 rounded mt-3">
                Note: The scam analysis is an AI assessment &mdash; it does not replace your own
                due diligence and is not a legally binding statement.
              </p>
            </Section>

            <Section title="8. Retention">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>Account/profile data:</strong> until account deletion, unless legal
                  obligations apply
                </li>
                <li>
                  <strong>Searches / wanted-ads / bookmarks:</strong> until you delete them or
                  delete your account
                </li>
                <li>
                  <strong>Chat content:</strong> for the duration of the conversation and to
                  improve future answers; deleted on request
                </li>
                <li>
                  <strong>Listings:</strong> until you delete them or they expire
                </li>
                <li>
                  <strong>Log data:</strong> only as long as necessary for security/debugging,
                  then deleted/anonymized
                </li>
                <li>
                  <strong>Hashes (phone/email pepper):</strong> permanently, as they are not
                  reversible
                </li>
              </ul>
            </Section>

            <Section title="9. Your rights">
              <p>
                Where GDPR applies, you have the right to access, rectify, delete, restrict
                processing, data portability, object to processing based on legitimate
                interests, and lodge a complaint with a supervisory authority (in Cyprus: Office
                of the Commissioner for Personal Data Protection).
              </p>
              <p className="mt-2">
                Contact:{" "}
                <a className="underline" href="mailto:info@mmhammer.org">
                  info@mmhammer.org
                </a>
              </p>
            </Section>

            <Section title="10. Cookies / local storage">
              <p>
                We use strictly necessary cookies and/or local storage for login, sessions,
                language and security. For audience analytics we use{" "}
                <strong>Plausible Analytics</strong> &mdash; cookieless, no individual user
                tracking, no third-country transfer. If we add further analytics/marketing
                tools, we will update this page (with consent where required).
              </p>
            </Section>

            <Section title="11. Minors">
              <p>
                The service is not intended for children. If you are under 18, please do not use
                Home4U without parental consent.
              </p>
            </Section>

            <Section title="12. No solely automated decisions with legal effect">
              <p>
                We do not make decisions based solely on automated processing that produce legal
                effects concerning you or similarly significantly affect you (GDPR Art. 22),
                unless explicitly stated otherwise.
              </p>
            </Section>
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

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold text-[var(--brand-navy)] mb-2">{title}</h2>
      {children}
    </section>
  );
}

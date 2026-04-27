import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Datenschutz — Home4U",
  description:
    "Wie Home4U deine Daten verarbeitet — kurz, klar und ohne Anwaltsdeutsch. Mit Sektion zum Scam-Shield.",
};

export default function DatenschutzPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] py-12 px-4">
      <article className="max-w-3xl mx-auto prose prose-sm md:prose-base prose-neutral">
        <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)] mb-2">
          Datenschutz
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mb-8">
          Stand: 27. April 2026. Wir halten das so kurz wie möglich.
        </p>

        <Section title="Wer wir sind">
          <p>
            Home4U ist eine KI-gestützte Immobilien-Suche für Zypern. Sophie ist die
            Persönlichkeit, mit der du chattest. Hinter dem Vorhang läuft Software,
            betrieben von der Home4U-Inhaberschaft (Kontakt: <a href="mailto:contact@home4u.ai">contact@home4u.ai</a>).
          </p>
        </Section>

        <Section title="Welche Daten wir verarbeiten">
          <ul>
            <li>
              <strong>Cookie-Session-ID</strong> (anonyme UUID) — damit du ohne Login einen
              Suchverlauf und Quotas hast. Bleibt 1 Jahr gültig, kannst du jederzeit löschen.
            </li>
            <li>
              <strong>E-Mail + Sophie-Chat-Verlauf</strong> — wenn du einen Account anlegst.
              Wird verschlüsselt gespeichert. Lösch-Funktion im Dashboard.
            </li>
            <li>
              <strong>Suchprofile</strong> — Stadt, Budget, Zimmer, freier Wunschtext.
              Wird zum Matching gegen unseren Inseratsindex verwendet.
            </li>
            <li>
              <strong>Inserate-Index</strong> — wir indexieren öffentlich zugängliche
              Inserate (Bazaraki, FB-Gruppen, eigene Direkteinträge). Telefonnummern und
              Volltexte werden serverseitig verschlüsselt gespeichert.
            </li>
          </ul>
        </Section>

        <Section title="Sophie-Chat">
          <p>
            Wenn du mit Sophie chattest, geht dein Text an unseren KI-Dienstleister
            (Anthropic, USA — Adequacy-Decision der EU-Kommission via SCC). Wir speichern
            Verlauf und Metadaten zu deinem Account, damit Sophie Kontext behält. Lösch-
            Funktion im Dashboard.
          </p>
        </Section>

        <hr className="my-8" />

        <Section title="Scam-Shield" id="scam-shield">
          <p>
            Wenn du auf <a href="/scam-check">/scam-check</a> ein Inserat hochlädst (Text,
            URL oder Screenshot), passiert Folgendes:
          </p>
          <ol>
            <li>
              <strong>Verarbeitung:</strong> Der Text bzw. das Bild geht an unseren
              KI-Dienstleister (Anthropic, USA), der die Eckdaten extrahiert. Bilder werden
              dort nicht persistiert.
            </li>
            <li>
              <strong>Speicherung bei uns:</strong> Wir speichern für 30 Tage:
              <ul>
                <li>den Original-Submit (verschlüsselt)</li>
                <li>die extrahierten Eckdaten + den Risiko-Score + die Erklärung</li>
                <li>einen Bild-Hash (kein Originalbild) für künftige Cross-Matches</li>
              </ul>
              Nach 30 Tagen wird der Eintrag automatisch gelöscht.
            </li>
            <li>
              <strong>Telefonnummern</strong> werden ausschließlich als sha256-Hash
              gespeichert — der Klartext bleibt nicht bei uns.
            </li>
            <li>
              <strong>Wenn du &bdquo;Inserat als Scam melden&ldquo; klickst:</strong> Der Phone-Hash
              wird in unsere Scam-Phone-Liste übernommen. Künftige Submissions mit
              derselben Nummer bekommen automatisch eine Warnung. Dein Report-Eintrag
              ist anonym (oder bei eingeloggten Usern: deine User-ID, nicht deine E-Mail
              im Klartext).
            </li>
            <li>
              <strong>Was wir NICHT speichern:</strong> keine IP-Adresse über die
              üblichen Server-Logs hinaus, keinen Browser-Fingerprint, keine
              Original-Bilder.
            </li>
          </ol>
          <p className="bg-[var(--brand-gold-50)] p-3 rounded text-sm">
            <strong>Wichtig:</strong> Das Scam-Shield ist ein <em>Risiko-Indikator</em>,
            kein juristisches Urteil. Kein Score 0.85 bedeutet automatisch &bdquo;dieses
            Inserat ist Scam&ldquo; — es bedeutet: mehrere Signale deuten darauf hin, prüf es
            zweimal. Sophie ist Werkzeug, nicht Schiedsrichter.
          </p>
        </Section>

        <hr className="my-8" />

        <Section title="Deine Rechte">
          <ul>
            <li>
              <strong>Auskunft:</strong> Kopie aller bei uns gespeicherten Daten — schreib
              uns an <a href="mailto:contact@home4u.ai">contact@home4u.ai</a>.
            </li>
            <li>
              <strong>Löschung:</strong> Eingeloggt → Self-Service im Dashboard.
              Anonym → Cookie löschen oder uns schreiben.
            </li>
            <li>
              <strong>Berichtigung:</strong> Wenn ein Inserat fälschlich auf der
              Scam-Phone-Liste steht — schreib uns, wir prüfen.
            </li>
            <li>
              <strong>Beschwerde:</strong> bei der zypriotischen Datenschutzbehörde
              (Office of the Commissioner for Personal Data Protection, Nicosia).
            </li>
          </ul>
        </Section>

        <Section title="Cookies">
          <p>
            Wir setzen ein einziges technisches Cookie (<code>home4u_sid</code>) für die
            anonyme Session. Kein Tracking, keine Werbe-Cookies, keine
            Drittanbieter-Skripte für Marketing.
          </p>
        </Section>

        <p className="text-sm text-[var(--muted-foreground)] mt-12">
          Fragen? Schreib uns an <a href="mailto:contact@home4u.ai">contact@home4u.ai</a>.
        </p>
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
    <section id={id} className="mb-8 scroll-mt-24">
      <h2 className="text-xl md:text-2xl font-serif font-medium text-[var(--brand-navy)] mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

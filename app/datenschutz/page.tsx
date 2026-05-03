import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { makeT, type T, type TKey } from "@/lib/i18n/dict";
import { getPreferredLanguage } from "@/lib/lang/preferred-language";

export async function generateMetadata(): Promise<Metadata> {
  const lang = (await getPreferredLanguage()) ?? "de";
  const t = makeT(lang);
  return {
    title: t("privacy.metaTitle"),
    description: t("privacy.metaDesc"),
  };
}

function md(text: string): React.ReactNode[] {
  // Inline **bold** and *italic*. Strings come from dict, no user input.
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const seg = m[0];
    if (seg.startsWith("**")) parts.push(<strong key={i++}>{seg.slice(2, -2)}</strong>);
    else parts.push(<em key={i++}>{seg.slice(1, -1)}</em>);
    last = m.index + seg.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default async function DatenschutzPage() {
  const { t } = await getT();
  return (
    <main className="min-h-screen bg-[var(--background)] py-12 px-4">
      <article className="max-w-3xl mx-auto prose prose-sm md:prose-base prose-neutral">
        <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)] mb-2">
          {t("privacy.heading")}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mb-8">
          {t("privacy.lastUpdated")}
        </p>

        <Section title={t("privacy.who.heading")}>
          <p>{md(t("privacy.who.text").replace("info@home4u.ai", ""))}<a href="mailto:info@home4u.ai">info@home4u.ai</a>).</p>
        </Section>

        <Section title={t("privacy.data.heading")}>
          <ul>
            <Li tk="privacy.data.cookie" t={t} />
            <Li tk="privacy.data.email" t={t} />
            <Li tk="privacy.data.searches" t={t} />
            <Li tk="privacy.data.index" t={t} />
          </ul>
        </Section>

        <Section title={t("privacy.chat.heading")}>
          <p>{md(t("privacy.chat.text"))}</p>
        </Section>

        <hr className="my-8" />

        <Section title={t("privacy.scam.heading")} id="scam-shield">
          <p>{md(t("privacy.scam.intro"))}</p>
          <ol>
            <Li tk="privacy.scam.processing" t={t} />
            <li>
              {md(t("privacy.scam.storage"))}
              <ul>
                <li>{t("privacy.scam.storageOriginal")}</li>
                <li>{t("privacy.scam.storageExtract")}</li>
                <li>{t("privacy.scam.storageHash")}</li>
              </ul>
              {t("privacy.scam.storageAfter")}
            </li>
            <Li tk="privacy.scam.phones" t={t} />
            <Li tk="privacy.scam.report" t={t} />
            <Li tk="privacy.scam.notStored" t={t} />
          </ol>
          <p className="bg-[var(--brand-gold-50)] p-3 rounded text-sm">
            {md(t("privacy.scam.disclaimer"))}
          </p>
        </Section>

        <hr className="my-8" />

        <Section title={t("privacy.rights.heading")}>
          <ul>
            <Li tk="privacy.rights.access" t={t} />
            <Li tk="privacy.rights.delete" t={t} />
            <Li tk="privacy.rights.fix" t={t} />
            <Li tk="privacy.rights.complaint" t={t} />
          </ul>
        </Section>

        <Section title={t("privacy.cookies.heading")}>
          <p>{md(t("privacy.cookies.text"))}</p>
        </Section>

        <p className="text-sm text-[var(--muted-foreground)] mt-12">
          {t("privacy.questions").replace("info@home4u.ai", "")}
          <a href="mailto:info@home4u.ai">info@home4u.ai</a>.
        </p>
      </article>
    </main>
  );
}

function Li({ tk, t }: { tk: TKey; t: T }) {
  return <li>{md(t(tk))}</li>;
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

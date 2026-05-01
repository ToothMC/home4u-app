import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { AuthMenu } from "@/components/auth/AuthMenu";
import { Button } from "@/components/ui/button";
import { ScamCheckClient } from "@/components/scam-shield/ScamCheckClient";
import { getAuthUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/dict";
import { getPreferredLanguage } from "@/lib/lang/preferred-language";

export async function generateMetadata(): Promise<Metadata> {
  const lang = (await getPreferredLanguage()) ?? "de";
  const t = makeT(lang);
  return {
    title: t("scamCheck.metaTitle"),
    description: t("scamCheck.metaDesc"),
  };
}

export default async function ScamCheckPage() {
  const user = await getAuthUser();
  const { t } = await getT();

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 pb-2 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> {t("common.back")}
        </Link>
        <AuthMenu />
      </header>

      <div className="max-w-2xl mx-auto mb-10 mt-8 text-center space-y-3 px-4">
        <h1 className="text-3xl md:text-4xl font-serif font-medium text-[var(--brand-navy)]">
          {t("scamCheck.title")}
        </h1>
        <p className="text-lg text-[var(--muted-foreground)]">
          {t("scamCheck.subtitle")}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t("scamCheck.freeQuota")}
        </p>
      </div>

      <div className="px-4 pb-12">
        {user ? (
          <ScamCheckClient />
        ) : (
          <LoginPrompt
            title={t("scamCheck.login.title")}
            text={t("scamCheck.login.text")}
            signin={t("scamCheck.login.signin")}
            signup={t("scamCheck.login.signup")}
          />
        )}
      </div>
    </main>
  );
}

function LoginPrompt({
  title,
  text,
  signin,
  signup,
}: {
  title: string;
  text: string;
  signin: string;
  signup: string;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border bg-[var(--card)] p-6 text-center space-y-4">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
        <ShieldCheck className="size-6" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
        {title}
      </h2>
      <p className="text-sm text-[var(--muted-foreground)]">{text}</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
        <Button asChild>
          <Link href="/?auth=required&next=/scam-check">{signin}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/?auth=required&next=/scam-check&mode=signup">
            {signup}
          </Link>
        </Button>
      </div>
    </div>
  );
}

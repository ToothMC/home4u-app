import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserCircle } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import {
  ProfileEditor,
  type ProfileForm,
} from "@/components/dashboard/ProfileEditor";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required&next=/dashboard/profile");
  }

  const { t } = await getT();
  const supabase = createSupabaseServiceClient();
  if (!supabase) redirect("/dashboard");

  const { data } = await supabase
    .from("profiles")
    .select(
      "id, role, display_name, phone, preferred_language, contact_channel, notification_email"
    )
    .eq("id", user.id)
    .maybeSingle();

  const initial: ProfileForm = {
    display_name: data?.display_name ?? null,
    phone: data?.phone ?? null,
    preferred_language: (data?.preferred_language ?? null) as ProfileForm["preferred_language"],
    contact_channel: (data?.contact_channel ?? null) as ProfileForm["contact_channel"],
    notification_email: data?.notification_email ?? null,
  };

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <BrandLockup />
          <AuthMenu />
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 pt-6 pb-12">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted-foreground)] hover:underline inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="size-4" /> {t("common.dashboard")}
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <UserCircle className="size-7 text-[var(--brand-navy)]" />
          <div>
            <h1 className="text-2xl font-semibold text-[var(--brand-navy)]">
              {t("profilePage.heading")}
            </h1>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {user.email}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-[var(--card)] p-5">
          <ProfileEditor initial={initial} authEmail={user.email} />
        </div>

        <p className="mt-6 text-xs text-[var(--muted-foreground)] leading-relaxed">
          {t("profilePage.privacy")}
        </p>
      </section>
    </main>
  );
}

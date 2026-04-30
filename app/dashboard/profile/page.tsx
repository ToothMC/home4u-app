import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Bell, UserCircle } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import {
  ProfileEditor,
  type ProfileForm,
} from "@/components/dashboard/ProfileEditor";
import {
  SearchNotificationToggles,
  type SearchNotificationItem,
} from "@/components/dashboard/SearchNotificationToggles";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required&next=/dashboard/profile");
  }

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

  const { data: searchRows } = await supabase
    .from("search_profiles")
    .select("id, location, type, rooms, budget_max, notify_new_matches")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  const searches: SearchNotificationItem[] = (searchRows ?? []).map((r) => ({
    id: r.id as string,
    location: (r.location as string) ?? "",
    type: (r.type as "rent" | "sale") ?? "rent",
    rooms: (r.rooms as number | null) ?? null,
    budget_max: r.budget_max != null ? Number(r.budget_max) : null,
    notify_new_matches: r.notify_new_matches !== false,
  }));

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
          <ArrowLeft className="size-4" /> Dashboard
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <UserCircle className="size-7 text-[var(--brand-navy)]" />
          <div>
            <h1 className="text-2xl font-semibold text-[var(--brand-navy)]">
              Mein Profil
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
          Telefon und Kontakt-Kanal werden erst geteilt, wenn beide Seiten
          einem Match zustimmen — vorher sieht niemand außer dir diese Daten.
        </p>

        <div className="mt-8 rounded-2xl border bg-[var(--card)] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Bell className="size-5 text-[var(--brand-navy)]" />
            <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
              Benachrichtigungen für meine Suchen
            </h2>
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mb-4">
            Wir schicken Dir einmal pro Tag eine E-Mail, wenn neue passende
            Inserate dazugekommen sind. Pro Suche einzeln steuerbar.
          </p>
          <SearchNotificationToggles initial={searches} />
        </div>
      </section>
    </main>
  );
}

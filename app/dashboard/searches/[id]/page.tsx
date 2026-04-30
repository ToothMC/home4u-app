import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import {
  SearchEditor,
  type EditableSearchProfile,
} from "@/components/dashboard/SearchEditor";
import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  const session = user ? null : await getOrCreateAnonymousSession();

  const supabase = createSupabaseServiceClient();
  if (!supabase) redirect("/dashboard");

  const { data, error } = await supabase
    .from("search_profiles")
    .select(
      `id, location, type, budget_min, budget_max, rooms, move_in_date,
       household, lifestyle_tags, pets, free_text, active, notify_new_matches,
       user_id, anonymous_id`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const ownedByUser = user && data.user_id === user.id;
  const ownedByAnon =
    session?.anonymousId && data.anonymous_id === session.anonymousId;
  if (!ownedByUser && !ownedByAnon) {
    redirect("/dashboard");
  }

  const profile: EditableSearchProfile = {
    id: data.id,
    location: data.location,
    type: data.type as "rent" | "sale",
    budget_min: data.budget_min ? Number(data.budget_min) : null,
    budget_max: data.budget_max ? Number(data.budget_max) : null,
    rooms: data.rooms,
    move_in_date: data.move_in_date,
    household: data.household,
    lifestyle_tags: data.lifestyle_tags,
    pets: data.pets,
    free_text: data.free_text,
    active: data.active,
    notify_new_matches: data.notify_new_matches !== false,
  };

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard?view=seeker"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Suchen
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-md w-full px-4 pt-4 pb-10">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Suche bearbeiten</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 flex items-center gap-1">
            <Sparkles className="size-3" />
            Sophie nutzt diese Daten zum Matchen — ändern beeinflusst direkt
            deine Treffer.
          </p>
        </div>

        <SearchEditor initial={profile} />
      </section>
    </main>
  );
}

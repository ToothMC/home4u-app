import Link from "next/link";
import { redirect } from "next/navigation";
import {
  MessageCircle,
  KeyRound,
  SearchIcon,
  ArrowRight,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { ListingCard } from "@/components/dashboard/ListingCard";
import { MatchSections } from "@/components/dashboard/MatchSections";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required");
  }

  const supabase = createSupabaseServiceClient();

  const isSeeker = user.role === "seeker";
  const isProvider = user.role === "owner" || user.role === "agent";

  let listings: Listing[] = [];
  let profiles: SearchProfile[] = [];

  if (supabase && isProvider) {
    const { data } = await supabase
      .from("listings")
      .select(
        "id, type, status, location_city, location_district, price, currency, rooms, size_sqm, contact_channel, language, media, updated_at"
      )
      .eq("owner_user_id", user.id)
      .order("updated_at", { ascending: false });
    listings = (data ?? []) as Listing[];
  }
  if (supabase && isSeeker) {
    const { data } = await supabase
      .from("search_profiles")
      .select(
        "id, location, budget_min, budget_max, rooms, move_in_date, household, active, updated_at"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    profiles = (data ?? []) as SearchProfile[];
  }

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-4 pt-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-[var(--muted-foreground)]">
          ← Home4U
        </Link>
        <AuthMenu />
      </div>

      <section className="mx-auto max-w-5xl px-4 pt-6 pb-10">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-2">
          Dein Dashboard
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mb-8">
          {user.email ? (
            <>
              Angemeldet als <strong>{user.email}</strong>
              {user.role ? (
                <>
                  {" "}
                  · Rolle: <strong>{roleLabel(user.role)}</strong>
                </>
              ) : null}
            </>
          ) : (
            <>Angemeldet</>
          )}
        </p>

        {!user.role ? (
          <RoleHint />
        ) : (
          <>
            {isSeeker && (
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <SearchIcon className="size-4" />
                    Meine Suchen ({profiles.length})
                  </h2>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/chat">+ Suche</Link>
                  </Button>
                </div>
                {profiles.length === 0 ? (
                  <Card>
                    <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
                      Noch keine Suchprofile. Klick oben auf{" "}
                      <strong>+ Suche</strong> und erzähl Sophie, wonach du
                      suchst.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {profiles.map((p) => (
                      <Card key={p.id}>
                        <CardHeader>
                          <CardTitle className="text-base">
                            {p.location}
                          </CardTitle>
                          <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {p.rooms ? <span>{p.rooms} Zimmer</span> : null}
                            {p.budget_max ? (
                              <span>
                                bis{" "}
                                {Number(p.budget_max).toLocaleString("de-DE")} €
                              </span>
                            ) : null}
                            {p.move_in_date ? (
                              <span>ab {p.move_in_date}</span>
                            ) : null}
                            {p.household ? <span>{p.household}</span> : null}
                            <span className="uppercase tracking-wider text-[10px]">
                              {p.active ? "aktiv" : "pausiert"}
                            </span>
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            )}

            {isProvider && (
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <KeyRound className="size-4" />
                    Meine Inserate ({listings.length})
                  </h2>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/chat">+ Inserat</Link>
                  </Button>
                </div>
                {listings.length === 0 ? (
                  <Card>
                    <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
                      Noch keine Inserate angelegt. Klick oben auf{" "}
                      <strong>+ Inserat</strong> — Sophie führt dich durch.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {listings.map((l) => (
                      <ListingCard key={l.id} listing={l} />
                    ))}
                  </div>
                )}
              </section>
            )}

            <MatchSections role={isSeeker ? "seeker" : "provider"} />

            <p className="mt-10 text-xs text-[var(--muted-foreground)]">
              Willst du lieber eine andere Rolle? Sag Sophie im{" "}
              <Link href="/chat" className="underline">
                Chat
              </Link>{" "}
              einfach Bescheid, z. B. &quot;ich will jetzt inserieren&quot; oder
              &quot;ich suche doch selbst&quot;.
            </p>
          </>
        )}

        <div className="mt-10 rounded-lg border p-4 bg-[var(--accent)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="size-5" />
            <p className="text-sm">Brauchst du noch etwas? Frag Sophie.</p>
          </div>
          <Button asChild size="sm">
            <Link href="/chat">Chat öffnen</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function RoleHint() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="size-4" />
          Erzähl Sophie kurz, worum&apos;s geht
        </CardTitle>
        <CardDescription>
          Damit dein Dashboard das Richtige zeigt, müssen wir wissen, ob du
          eine Immobilie suchst, anbietest oder als Makler mehrere Objekte
          vermarktest. Schreib Sophie einfach einen Satz — sie erkennt das
          direkt und legt los.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/chat">
            <MessageCircle className="mr-1" />
            Chat öffnen
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "seeker":
      return "Suchender";
    case "owner":
      return "Eigentümer";
    case "agent":
      return "Makler";
    case "admin":
      return "Admin";
    default:
      return role;
  }
}

type Listing = {
  id: string;
  type: "rent" | "sale";
  status: string;
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  contact_channel: string | null;
  language: string | null;
  media: string[] | null;
  updated_at: string;
};

type SearchProfile = {
  id: string;
  location: string;
  budget_min: number | null;
  budget_max: number | null;
  rooms: number | null;
  move_in_date: string | null;
  household: string | null;
  active: boolean;
  updated_at: string;
};

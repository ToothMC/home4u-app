import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, KeyRound, SearchIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { ListingRow } from "@/components/dashboard/ListingRow";
import { SearchRow } from "@/components/dashboard/SearchRow";
import { MatchSections } from "@/components/dashboard/MatchSections";
import { DashboardViewTabs } from "@/components/dashboard/DashboardViewTabs";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type View = "seeker" | "provider";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required");
  }

  const supabase = createSupabaseServiceClient();

  let listings: Listing[] = [];
  let profiles: SearchProfile[] = [];
  const listingRequestCounts: Record<string, number> = {}; // neu (offen)
  const listingHandledCounts: Record<string, number> = {}; // bearbeitet
  const profileMatchCounts: Record<string, number> = {};

  if (supabase) {
    const [listingRes, profileRes] = await Promise.all([
      supabase
        .from("listings")
        .select(
          "id, type, status, location_city, location_district, price, currency, rooms, size_sqm, contact_channel, language, media, updated_at"
        )
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("search_profiles")
        .select(
          "id, location, budget_min, budget_max, rooms, move_in_date, household, active, updated_at"
        )
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
    ]);
    listings = (listingRes.data ?? []) as Listing[];
    profiles = (profileRes.data ?? []) as SearchProfile[];

    // Anfragen pro Listing — getrennt nach neu (owner_decided_at IS NULL)
    // und bearbeitet (owner_decided_at IS NOT NULL)
    if (listings.length > 0) {
      const ids = listings.map((l) => l.id);
      const { data: matchRows } = await supabase
        .from("matches")
        .select("listing_id, owner_decided_at")
        .in("listing_id", ids)
        .eq("seeker_interest", true);
      for (const m of matchRows ?? []) {
        const key = m.listing_id as string;
        listingRequestCounts[key] = listingRequestCounts[key] ?? 0;
        listingHandledCounts[key] = listingHandledCounts[key] ?? 0;
        if (m.owner_decided_at) {
          listingHandledCounts[key] += 1;
        } else {
          listingRequestCounts[key] += 1;
        }
      }
    }

    // Treffer pro Suchprofil (RPC pro Profil, für MVP ausreichend)
    for (const p of profiles) {
      const { data: matches } = await supabase.rpc(
        "match_listings_for_profile",
        {
          p_user_id: user.id,
          p_profile_id: p.id,
          p_limit: 100,
        }
      );
      profileMatchCounts[p.id] = (matches ?? []).length;
    }
  }

  // View-Default: URL-Param → profiles.role (seeker/owner/agent) → erste
  // existierende Daten-Art → 'seeker'
  const params = await searchParams;
  const urlView = params.view;
  const viewFromRole: View | null =
    user.role === "owner" || user.role === "agent" ? "provider" : user.role === "seeker" ? "seeker" : null;
  const viewFromData: View | null =
    listings.length > 0 && profiles.length === 0
      ? "provider"
      : profiles.length > 0 && listings.length === 0
        ? "seeker"
        : null;
  const view: View =
    urlView === "seeker" || urlView === "provider"
      ? urlView
      : viewFromRole ?? viewFromData ?? "seeker";

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
        <p className="text-sm text-[var(--muted-foreground)] mb-6">
          {user.email ? (
            <>
              Angemeldet als <strong>{user.email}</strong>
            </>
          ) : (
            <>Angemeldet</>
          )}
        </p>

        <DashboardViewTabs current={view} />

        {view === "seeker" ? (
          <SeekerView profiles={profiles} matchCounts={profileMatchCounts} />
        ) : (
          <ProviderView
            listings={listings}
            newCounts={listingRequestCounts}
            handledCounts={listingHandledCounts}
            canBulkImport={user.role === "agent" || user.role === "admin"}
          />
        )}

        <MatchSections role={view} />

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

function SeekerView({
  profiles,
  matchCounts,
}: {
  profiles: SearchProfile[];
  matchCounts: Record<string, number>;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <SearchIcon className="size-4" />
          Meine Suchen ({profiles.length})
        </h2>
        <Button asChild size="sm" variant="outline">
          <Link href="/chat?flow=seeker">+ Suche</Link>
        </Button>
      </div>
      {profiles.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
            Noch keine Suchprofile. Klick oben auf <strong>+ Suche</strong> und
            erzähl Sophie, wonach du suchst.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <SearchRow
              key={p.id}
              profile={p}
              matchCount={matchCounts[p.id] ?? 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderView({
  listings,
  newCounts,
  handledCounts,
  canBulkImport,
}: {
  listings: Listing[];
  newCounts: Record<string, number>;
  handledCounts: Record<string, number>;
  canBulkImport: boolean;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound className="size-4" />
          Meine Inserate ({listings.length})
        </h2>
        <div className="flex gap-2">
          {canBulkImport && (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/import">
                <Upload className="size-3" /> Bulk-Import
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href="/chat?flow=owner">+ Inserat</Link>
          </Button>
        </div>
      </div>
      {listings.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
            Noch keine Inserate angelegt. Klick oben auf{" "}
            <strong>+ Inserat</strong> — Sophie führt dich durch.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {listings.map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              newCount={newCounts[l.id] ?? 0}
              handledCount={handledCounts[l.id] ?? 0}
            />
          ))}
        </div>
      )}
    </section>
  );
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

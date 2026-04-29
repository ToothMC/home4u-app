"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Inbox, Send, Loader2, Handshake, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { OwnerInboxCard, type OwnerInboxRow } from "./OwnerInboxCard";
import { AvailabilityChips } from "./AvailabilityChips";
import { onMatchesUpdated } from "@/lib/events/match-events";

type OutboxRow = {
  match_id: string;
  listing_id: string;
  listing_title: string | null;
  listing_status:
    | "active"
    | "stale"
    | "opted_out"
    | "archived"
    | "rented"
    | "sold"
    | "reserved";
  listing_type: "rent" | "sale";
  listing_city: string;
  listing_district: string | null;
  listing_price: number;
  listing_rooms: number | null;
  listing_size_sqm: number | null;
  listing_contact_channel: string | null;
  listing_media: string[] | null;
  seeker_interest: boolean;
  owner_interest: boolean | null;
  connected_at: string | null;
  owner_contact: { channel?: string; email?: string } | null;
};

export function MatchSections({
  role,
}: {
  role: "seeker" | "provider";
}) {
  const [inbox, setInbox] = useState<OwnerInboxRow[] | null>(null);
  const [outbox, setOutbox] = useState<OutboxRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (role === "provider") {
      const inRes = await fetch("/api/matches/inbox", { cache: "no-store" });
      if (inRes.ok) {
        const d = await inRes.json();
        setInbox(d.matches ?? []);
      } else {
        setInbox([]);
      }
    } else {
      const outRes = await fetch("/api/matches/outbox", { cache: "no-store" });
      if (outRes.ok) {
        const d = await outRes.json();
        setOutbox(d.matches ?? []);
      } else {
        setOutbox([]);
      }
    }
  }

  useEffect(() => {
    load();
    // Sub: re-fetch sobald irgendwo eine neue Anfrage gesendet wurde
    // (InquireButton, RequestVisitButton, Sophie's confirm_match_request).
    const unsub = onMatchesUpdated(() => {
      load();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function respond(matchId: string, accept: boolean) {
    setBusyId(matchId);
    await fetch("/api/matches/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match_id: matchId, accept }),
    });
    setBusyId(null);
    load();
  }

  if (role === "provider") {
    return (
      <section id="match-inbox" className="mt-8 scroll-mt-8">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
          <Inbox className="size-4" />
          Anfragen an dich ({inbox?.length ?? "…"})
        </h2>
        {inbox === null ? (
          <p className="text-xs text-[var(--muted-foreground)]">Lädt…</p>
        ) : inbox.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
              Noch keine Anfragen für deine Inserate.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {inbox.map((m) => (
              <OwnerInboxCard
                key={m.match_id}
                row={m}
                onRespond={respond}
                busyId={busyId}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  // role === "seeker" → nur Outbox
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
        <Send className="size-4" />
        Meine Anfragen ({outbox?.length ?? "…"})
      </h2>
      {outbox === null ? (
        <p className="text-xs text-[var(--muted-foreground)]">Lädt…</p>
      ) : outbox.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
            Noch keine Anfragen gesendet. Bitte Sophie im Chat, ein Match
            anzufragen.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {outbox.map((m) => {
            const cover = m.listing_media?.[0];
            return (
              <Link
                key={m.match_id}
                href={`/matches/${m.match_id}`}
                className={`group flex items-stretch gap-3 rounded-lg border bg-[var(--card)] p-2 hover:bg-[var(--accent)] transition-colors ${
                  ["rented", "sold", "opted_out", "reserved"].includes(m.listing_status)
                    ? "opacity-60"
                    : ""
                }`}
              >
                <div className="relative shrink-0 size-20 overflow-hidden rounded-md bg-[var(--muted)] border">
                  {cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cover}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[10px] text-[var(--muted-foreground)]">
                      kein Bild
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div>
                    <p className="truncate text-sm font-medium">
                      {m.listing_city}
                      {m.listing_district ? ` · ${m.listing_district}` : ""}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {m.listing_rooms ?? "?"} Zi ·{" "}
                      {Number(m.listing_price).toLocaleString("de-DE")} €
                      {m.listing_size_sqm ? ` · ${m.listing_size_sqm} m²` : ""}
                    </p>
                  </div>
                  <div className="text-[10px]">
                    {m.listing_status === "rented" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--destructive)]/15 px-2 py-0.5 text-[var(--destructive)] font-semibold uppercase tracking-wider">
                        Inserat vermietet
                      </span>
                    ) : m.listing_status === "sold" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--destructive)]/15 px-2 py-0.5 text-[var(--destructive)] font-semibold uppercase tracking-wider">
                        Inserat verkauft
                      </span>
                    ) : m.listing_status === "reserved" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                        reserviert
                      </span>
                    ) : m.listing_status === "stale" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                        Inserat fraglich
                      </span>
                    ) : m.connected_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                        <Handshake className="size-3" /> verbunden
                      </span>
                    ) : m.owner_interest === false ? (
                      <span className="uppercase tracking-wider text-[var(--destructive)]">
                        abgelehnt
                      </span>
                    ) : (
                      <span className="uppercase tracking-wider text-[var(--muted-foreground)]">
                        wartet auf Anbieter
                      </span>
                    )}
                  </div>
                  {m.listing_status === "active" && (
                    <AvailabilityChips matchId={m.match_id} listingId={m.listing_id} />
                  )}
                </div>
                <ChevronRight className="size-4 self-center text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Inbox, Send, Check, X, Loader2, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type InboxRow = {
  match_id: string;
  listing_id: string;
  listing_city: string;
  listing_district: string | null;
  listing_price: number;
  listing_rooms: number | null;
  score: number;
  seeker_interest: boolean;
  owner_interest: boolean | null;
  owner_decided_at: string | null;
  connected_at: string | null;
  seeker_profile: {
    location: string;
    budget_max: number | null;
    rooms: number | null;
    household: string | null;
    move_in_date: string | null;
    lifestyle_tags: string[] | null;
    email: string | null;
  };
};

type OutboxRow = {
  match_id: string;
  listing_id: string;
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

export function MatchSections() {
  const [inbox, setInbox] = useState<InboxRow[] | null>(null);
  const [outbox, setOutbox] = useState<OutboxRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [inRes, outRes] = await Promise.all([
      fetch("/api/matches/inbox", { cache: "no-store" }),
      fetch("/api/matches/outbox", { cache: "no-store" }),
    ]);
    if (inRes.ok) {
      const d = await inRes.json();
      setInbox(d.matches ?? []);
    } else {
      setInbox([]);
    }
    if (outRes.ok) {
      const d = await outRes.json();
      setOutbox(d.matches ?? []);
    } else {
      setOutbox([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="grid gap-6 md:grid-cols-2 mt-8">
      {/* Owner-Inbox */}
      <section>
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
              <Card key={m.match_id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    Anfrage für {m.listing_city}
                    {m.listing_district ? ` · ${m.listing_district}` : ""}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {m.listing_rooms ?? "?"} Zi ·{" "}
                    {Number(m.listing_price).toLocaleString("de-DE")} €
                    {m.connected_at ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <Handshake className="size-3" /> verbunden
                      </span>
                    ) : m.owner_interest === false ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--destructive)]">
                        abgelehnt
                      </span>
                    ) : (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                        offen
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span>Sucht in {m.seeker_profile.location}</span>
                    {m.seeker_profile.rooms ? (
                      <span>{m.seeker_profile.rooms} Zi</span>
                    ) : null}
                    {m.seeker_profile.budget_max ? (
                      <span>
                        bis{" "}
                        {Number(
                          m.seeker_profile.budget_max
                        ).toLocaleString("de-DE")}{" "}
                        €
                      </span>
                    ) : null}
                    {m.seeker_profile.household ? (
                      <span>{m.seeker_profile.household}</span>
                    ) : null}
                    {m.seeker_profile.move_in_date ? (
                      <span>ab {m.seeker_profile.move_in_date}</span>
                    ) : null}
                  </div>

                  {m.connected_at && m.seeker_profile.email ? (
                    <p className="rounded bg-[var(--accent)] px-2 py-1">
                      Kontakt: {m.seeker_profile.email}
                    </p>
                  ) : null}

                  {!m.connected_at && m.owner_interest !== false && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => respond(m.match_id, true)}
                        disabled={busyId === m.match_id}
                      >
                        {busyId === m.match_id ? (
                          <Loader2 className="animate-spin size-3" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        Annehmen
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respond(m.match_id, false)}
                        disabled={busyId === m.match_id}
                      >
                        <X className="size-3" />
                        Ablehnen
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Seeker-Outbox */}
      <section>
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
            {outbox.map((m) => (
              <Card key={m.match_id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {m.listing_city}
                    {m.listing_district ? ` · ${m.listing_district}` : ""}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {m.listing_rooms ?? "?"} Zi ·{" "}
                    {Number(m.listing_price).toLocaleString("de-DE")} €
                    {m.listing_size_sqm ? ` · ${m.listing_size_sqm} m²` : ""}
                    {m.connected_at ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <Handshake className="size-3" /> verbunden
                      </span>
                    ) : m.owner_interest === false ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--destructive)]">
                        abgelehnt
                      </span>
                    ) : (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                        wartet
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {m.connected_at && m.owner_contact?.email ? (
                    <p className="rounded bg-[var(--accent)] px-2 py-1">
                      Kontakt: {m.owner_contact.email}
                      {m.owner_contact.channel
                        ? ` · ${m.owner_contact.channel}`
                        : ""}
                    </p>
                  ) : !m.connected_at && m.owner_interest !== false ? (
                    <p className="text-[var(--muted-foreground)]">
                      Wir warten auf die Bestätigung des Anbieters. Du wirst
                      hier informiert sobald es weitergeht.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

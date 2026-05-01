"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Check, Loader2, MessageCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EligibleListing = {
  id: string;
  title: string | null;
  location_city: string | null;
  location_district: string | null;
  price: number | null;
  currency: string | null;
  rooms: number | null;
  size_sqm: number | null;
  property_type: string | null;
  cover_url: string | null;
};

type OfferState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; matchId: string; connected: boolean }
  | { kind: "error"; message: string };

export function OfferToSeekerPicker({
  profileId,
  listings,
}: {
  profileId: string;
  listings: EligibleListing[];
}) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<string | null>(
    listings.length === 1 ? listings[0].id : null
  );
  const [state, setState] = React.useState<OfferState>({ kind: "idle" });

  async function submit() {
    if (!picked) return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/gesuche/${profileId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_id: picked }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        match_id?: string;
        connected?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.ok || !json.match_id) {
        setState({
          kind: "error",
          message: json.detail ?? json.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setState({
        kind: "ok",
        matchId: json.match_id,
        connected: Boolean(json.connected),
      });
      router.refresh();
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (state.kind === "ok") {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-800 font-medium">
          <Check className="size-5" /> Angebot verschickt
        </div>
        <p className="text-sm text-emerald-900">
          Der Sucher sieht dein Angebot in seinem Home4U-Postfach und bekommt
          eine Trigger-Mail. Antworten landen in deiner Inbox — keine echte
          Email-Adresse wird ausgetauscht.
        </p>
        <Link
          href={`/dashboard/requests/${state.matchId}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800 hover:underline"
        >
          <MessageCircle className="size-4" />
          {state.connected ? "Connection ansehen" : "Anfrage ansehen"}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-white px-4 py-4 space-y-3">
      <h2 className="text-sm font-medium">
        Welche deiner Wohnungen möchtest du anbieten?
      </h2>
      <ul className="space-y-2">
        {listings.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => setPicked(l.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                picked === l.id
                  ? "border-[var(--foreground)] bg-[var(--muted)]"
                  : "hover:border-[var(--foreground)]"
              )}
              aria-pressed={picked === l.id}
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-[var(--muted)]">
                {l.cover_url ? (
                  <Image
                    src={l.cover_url}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {l.title ?? "Inserat"}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] truncate">
                  {[l.location_district, l.location_city].filter(Boolean).join(", ")}
                  {" · "}
                  {l.price && l.currency
                    ? new Intl.NumberFormat("de-DE", {
                        style: "currency",
                        currency: l.currency,
                        maximumFractionDigits: 0,
                      }).format(l.price)
                    : "Preis n.A."}
                  {l.rooms ? ` · ${l.rooms} Zi` : ""}
                  {l.size_sqm ? ` · ${l.size_sqm}m²` : ""}
                </div>
              </div>
              <span
                className={cn(
                  "size-4 shrink-0 rounded-full border",
                  picked === l.id
                    ? "border-[var(--foreground)] bg-[var(--foreground)]"
                    : "border-neutral-300"
                )}
              >
                {picked === l.id ? (
                  <Check className="size-3 text-[var(--background)] m-0.5" />
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {state.kind === "error" ? (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>
            {state.message === "rate_limited"
              ? "Du hast heute schon 5 Anbieter-Anfragen gesendet — Limit erreicht. Versuch's morgen."
              : state.message === "listing_not_owned"
              ? "Dieses Inserat gehört nicht dir oder ist nicht aktiv."
              : state.message === "profile_not_public"
              ? "Dieses Such-Inserat ist nicht mehr veröffentlicht."
              : `Fehler: ${state.message}`}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-[var(--muted-foreground)]">
          Email bleibt unsichtbar. Kontakt läuft über dein Home4U-Postfach.
        </p>
        <Button
          type="button"
          onClick={submit}
          disabled={!picked || state.kind === "submitting"}
        >
          {state.kind === "submitting" ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              senden …
            </>
          ) : (
            "Wohnung anbieten"
          )}
        </Button>
      </div>
    </div>
  );
}

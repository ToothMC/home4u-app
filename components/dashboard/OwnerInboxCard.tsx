"use client";

import * as React from "react";
import {
  Check,
  X,
  Loader2,
  Handshake,
  MapPin,
  CalendarDays,
  PawPrint,
  Users2,
  Sparkles,
  Mail,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

export type SeekerProfile = {
  location: string;
  budget_min: number | null;
  budget_max: number | null;
  rooms: number | null;
  household: string | null;
  move_in_date: string | null;
  lifestyle_tags: string[] | null;
  pets: boolean | null;
  free_text: string | null;
  email: string | null;
};

export type OwnerInboxRow = {
  match_id: string;
  listing_id: string;
  listing_city: string;
  listing_district: string | null;
  listing_price: number;
  listing_rooms: number | null;
  listing_size_sqm: number | null;
  listing_media: string[] | null;
  seeker_interest: boolean;
  seeker_decided_at: string | null;
  owner_interest: boolean | null;
  owner_decided_at: string | null;
  connected_at: string | null;
  seeker_profile: SeekerProfile;
};

type Status = "pending" | "accepted" | "rejected" | "connected";

const HOUSEHOLD_KEY: Record<string, TKey> = {
  single: "household.single",
  couple: "household.couple",
  family: "household.family",
  shared: "household.shared",
};

function deriveStatus(row: OwnerInboxRow): Status {
  if (row.connected_at) return "connected";
  if (row.owner_interest === true) return "accepted";
  if (row.owner_interest === false) return "rejected";
  return "pending";
}

function initials(profile: SeekerProfile): string {
  if (profile.email) {
    return profile.email[0]?.toUpperCase() ?? "?";
  }
  return "?";
}

function formatBudget(p: SeekerProfile, lang: string, t: T): string | null {
  if (!p.budget_max) return null;
  const loc = NUMBER_LOCALE[lang] ?? "en-GB";
  if (p.budget_min && p.budget_min > 0) {
    return `${Number(p.budget_min).toLocaleString(loc)}–${Number(p.budget_max).toLocaleString(loc)} €`;
  }
  return `${t("common.budgetUpTo")} ${Number(p.budget_max).toLocaleString(loc)} €`;
}

export function OwnerInboxCard({
  row,
  onRespond,
  busyId,
}: {
  row: OwnerInboxRow;
  onRespond: (matchId: string, accept: boolean) => void;
  busyId: string | null;
}) {
  const { t, lang } = useT();
  const status = deriveStatus(row);
  const cover = row.listing_media?.[0] ?? null;
  const profile = row.seeker_profile;
  const budget = formatBudget(profile, lang, t);
  const householdKey = profile.household ? HOUSEHOLD_KEY[profile.household] : null;
  const household = householdKey ? t(householdKey) : profile.household;
  const isBusy = busyId === row.match_id;
  const dateLocale = NUMBER_LOCALE[lang] ?? "en-GB";

  return (
    <article className="rounded-xl border bg-[var(--card)] overflow-hidden">
      <Link
        href={`/dashboard/requests/${row.match_id}`}
        className="group flex items-stretch gap-3 px-3 py-3 hover:bg-[var(--accent)] transition-colors"
      >
        <div className="shrink-0 size-20 overflow-hidden rounded-md bg-[var(--muted)] border">
          {cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={cover}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[10px] text-[var(--muted-foreground)]">
              {t("match.noImage")}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold">
              {row.listing_city}
              {row.listing_district ? ` · ${row.listing_district}` : ""}
            </p>
            <StatusBadge status={status} t={t} />
          </div>
          <p className="text-xs text-[var(--muted-foreground)] truncate">
            {row.listing_rooms != null ? `${row.listing_rooms} ${t("matchCard.roomsShort")}` : ""}
            {row.listing_size_sqm ? ` · ${row.listing_size_sqm} m²` : ""}
            {" · "}
            {Number(row.listing_price).toLocaleString(dateLocale)} €
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
            {row.seeker_decided_at
              ? tFormat(t("ownerInbox.requestFromDate"), {
                  date: new Date(row.seeker_decided_at).toLocaleDateString(dateLocale),
                })
              : t("ownerInbox.requestFrom")}
          </p>
        </div>
        <ChevronRight className="size-4 self-center text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>

      <div className="border-t px-3 py-3 space-y-2 bg-[var(--accent)]/40">
        <div className="flex items-start gap-2">
          <div className="shrink-0 size-9 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-sm font-semibold">
            {initials(profile)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {status === "connected" && profile.email
                ? profile.email
                : t("ownerInbox.contactAfter")}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1 truncate">
              <MapPin className="size-3" />{" "}
              {tFormat(t("ownerInbox.searchesIn"), { location: profile.location })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {profile.rooms != null && (
            <Fact icon={null} label={t("matchCard.rooms")} value={`${profile.rooms} ${t("matchCard.roomsShort")}`} />
          )}
          {budget && <Fact icon={null} label={t("ownerInbox.budget")} value={budget} />}
          {household && (
            <Fact
              icon={<Users2 className="size-3" />}
              label={t("searchEditor.household")}
              value={household}
            />
          )}
          {profile.move_in_date && (
            <Fact
              icon={<CalendarDays className="size-3" />}
              label={t("ownerInbox.moveIn")}
              value={new Date(profile.move_in_date).toLocaleDateString(dateLocale)}
            />
          )}
          {profile.pets != null && (
            <Fact
              icon={<PawPrint className="size-3" />}
              label={t("searchEditor.pets")}
              value={profile.pets ? t("searchEditor.pets.yes") : t("searchEditor.pets.no")}
            />
          )}
        </div>

        {profile.lifestyle_tags && profile.lifestyle_tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {profile.lifestyle_tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/70 border px-2 py-0.5 text-[10px]"
              >
                <Sparkles className="inline size-2.5 mr-0.5" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {profile.free_text && (
          <p className="text-xs text-[var(--muted-foreground)] italic line-clamp-2 pt-1">
            &bdquo;{profile.free_text}&ldquo;
          </p>
        )}
      </div>

      <div className="px-3 py-3 border-t">
        {status === "connected" && (
          <Link
            href={`/dashboard/anfragen/${row.match_id}`}
            className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5"
          >
            <Mail className="size-4" /> {t("ownerInbox.contact")}
          </Link>
        )}
        {status === "rejected" && (
          <p className="text-xs text-center text-[var(--muted-foreground)] py-2">
            {t("ownerInbox.rejectedNote")}
          </p>
        )}
        {status === "accepted" && !row.connected_at && (
          <p className="text-xs text-center text-[var(--muted-foreground)] py-2">
            {t("ownerInbox.acceptedWaiting")}
          </p>
        )}
        {status === "pending" && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => onRespond(row.match_id, false)}
              disabled={isBusy}
              className="h-12 rounded-full border-2"
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              {t("ownerInbox.reject")}
            </Button>
            <Button
              size="lg"
              onClick={() => onRespond(row.match_id, true)}
              disabled={isBusy}
              className={cn(
                "h-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
              )}
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("ownerInbox.accept")}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status, t }: { status: Status; t: T }) {
  if (status === "connected") {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <Handshake className="size-3" /> {t("ownerInbox.status.connected")}
      </span>
    );
  }
  if (status === "accepted") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        {t("ownerInbox.status.accepted")}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
        {t("ownerInbox.status.rejected")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-700 animate-pulse">
      {t("ownerInbox.status.new")}
    </span>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className="ml-1 inline-flex items-center gap-1 text-xs">
        {icon}
        {value}
      </span>
    </div>
  );
}

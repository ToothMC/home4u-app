"use client";

import Link from "next/link";
import { ChevronRight, SearchIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { tFormat } from "@/lib/i18n/dict";

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

export type SearchRowData = {
  id: string;
  location: string;
  rooms: number | null;
  budget_max: number | null;
  move_in_date: string | null;
  household: string | null;
  active: boolean;
};

export function SearchRow({
  profile,
  matchCount,
}: {
  profile: SearchRowData;
  matchCount: number;
}) {
  const { t, lang } = useT();
  return (
    <div className="group flex items-stretch gap-3 rounded-lg border bg-[var(--card)] hover:bg-[var(--accent)] transition-colors">
      <Link
        href={`/dashboard/searches/${profile.id}`}
        className="flex flex-1 items-center gap-3 p-2 min-w-0"
      >
        <div className="shrink-0 size-14 rounded-md bg-[var(--muted)] border flex items-center justify-center">
          <SearchIcon className="size-5 text-[var(--muted-foreground)]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{profile.location}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {profile.rooms ? `${profile.rooms} ${t("matchCard.roomsShort")}` : "?"}
            {profile.budget_max
              ? ` · ${t("searchRow.budgetUpTo")} ${Number(profile.budget_max).toLocaleString(NUMBER_LOCALE[lang] ?? "en-GB")} €`
              : ""}
            {profile.move_in_date ? ` · ${t("searchRow.moveIn")} ${profile.move_in_date}` : ""}
            {profile.household ? ` · ${profile.household}` : ""}
          </p>
        </div>
      </Link>

      <div className="flex items-center gap-2 pr-2">
        <Link
          href="/matches"
          className="flex flex-col items-end gap-0.5 text-xs hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {matchCount > 0 ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
              {tFormat(t("searchRow.matches"), { n: matchCount })}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {t("searchRow.matchesNone")}
            </span>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {profile.active ? t("searchRow.active") : t("searchRow.paused")}
          </span>
        </Link>
        <ChevronRight className="size-4 self-center text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

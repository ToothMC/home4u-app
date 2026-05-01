"use client";

import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { tFormat } from "@/lib/i18n/dict";

const SOURCE_LABELS: Record<string, string> = {
  bazaraki: "Bazaraki",
  index_cy: "INDEX.cy",
  cyprus_real_estate: "Cyprus-Real.Estate",
  fb: "Facebook",
  direct: "Home4U",
  other: "—",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function SourceLinkButton({
  sourceUrl,
  source,
  full,
}: {
  sourceUrl: string;
  source: string;
  full?: boolean;
}) {
  const { t } = useT();
  const label = sourceLabel(source);
  return (
    <div className="space-y-2">
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={
          "flex items-center justify-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium " +
          (full ? "w-full h-12" : "h-11 px-5")
        }
      >
        <ExternalLink className="size-4" />
        {tFormat(t("sourceLink.cta"), { label })}
      </a>
      <p className="text-xs text-[var(--muted-foreground)] text-center px-2">
        {t("sourceLink.hint")}
      </p>
    </div>
  );
}

export function NoContactFallback({ full }: { full?: boolean }) {
  const { t } = useT();
  return (
    <div
      className={
        "rounded-xl border border-[var(--muted)] bg-[var(--card)] p-3 text-sm " +
        (full ? "w-full" : "")
      }
    >
      <p className="font-semibold mb-1">{t("noContact.heading")}</p>
      <p className="text-xs text-[var(--muted-foreground)]">{t("noContact.text")}</p>
    </div>
  );
}

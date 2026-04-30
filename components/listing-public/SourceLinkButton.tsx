import { ExternalLink } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  bazaraki: "Bazaraki",
  index_cy: "INDEX.cy",
  cyprus_real_estate: "Cyprus-Real.Estate",
  fb: "Facebook",
  direct: "Home4U",
  other: "externer Quelle",
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
        Direkt zum Inserat auf {label}
      </a>
      <p className="text-xs text-[var(--muted-foreground)] text-center px-2">
        Anbieter-Kontakt liegt uns nicht vor — du kommst hier auf das
        Original-Inserat und kannst dort direkt anfragen.
      </p>
    </div>
  );
}

export function NoContactFallback({ full }: { full?: boolean }) {
  return (
    <div
      className={
        "rounded-xl border border-[var(--muted)] bg-[var(--card)] p-3 text-sm " +
        (full ? "w-full" : "")
      }
    >
      <p className="font-semibold mb-1">Kontakt aktuell nicht verfügbar</p>
      <p className="text-xs text-[var(--muted-foreground)]">
        Wir konnten weder den Anbieter-Kontakt noch die Original-Quelle
        ermitteln. Bitte versuche es später nochmal.
      </p>
    </div>
  );
}

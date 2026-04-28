import { ExternalLink, BadgeCheck } from "lucide-react";
import {
  isBridgeSource,
  isPlatformSource,
  buildSourceUrl,
  sourceLabel,
} from "@/lib/listings/source";

/**
 * Kleine Pille neben dem Listing-Titel, die transparent macht: Ist das
 * ein direkt auf Home4U eingetragenes Inserat oder nur ein Index-Eintrag
 * aus einer externen Quelle (Bazaraki/FB)?
 */
export function SourceBadge({
  source,
}: {
  source: string | null | undefined;
}) {
  const bridge = isBridgeSource(source);
  const platform = isPlatformSource(source);
  const label = sourceLabel(source);

  if (platform) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        <BadgeCheck className="size-3" />
        Direkt auf Home4U
      </span>
    );
  }

  if (bridge) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
        <ExternalLink className="size-3" />
        Quelle: {label}
      </span>
    );
  }

  return null;
}

/**
 * Voller Button, der auf das Original-Inserat verlinkt — bei Bridge-
 * Listings statt eines Sophie-Kontakt-Buttons. Liefert null, wenn keine
 * deterministische URL gebaut werden kann (z.B. FB).
 */
export function SourceCTA({
  source,
  externalId,
  full,
}: {
  source: string | null | undefined;
  externalId: string | null | undefined;
  full?: boolean;
}) {
  const url = buildSourceUrl(source, externalId);
  if (!url) return null;
  const label = sourceLabel(source);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={
        "flex items-center justify-center gap-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors " +
        (full ? "w-full h-12" : "h-11 px-5")
      }
    >
      <ExternalLink className="size-4" />
      Zum Original auf {label}
    </a>
  );
}

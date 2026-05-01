"use client";

import { Phone, Loader2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

type RevealedContact = { phone: string | null; email: string | null };

export function RevealPhoneButton({
  listingId,
  isAuthenticated,
  source,
  sourceUrl,
  full,
}: {
  listingId: string;
  isAuthenticated: boolean;
  source: string;
  sourceUrl: string | null;
  full?: boolean;
}) {
  const { t } = useT();
  const [contact, setContact] = useState<RevealedContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sizing = full ? "w-full h-12" : "h-11 px-5";
  const baseClasses =
    "flex items-center justify-center gap-2 rounded-full font-medium " +
    sizing;

  if (!isAuthenticated) {
    const next = encodeURIComponent(`/listings/${listingId}`);
    return (
      <div className="space-y-2">
        <a
          href={`/?auth=required&next=${next}`}
          className={
            baseClasses +
            " bg-emerald-700 hover:bg-emerald-800 text-white"
          }
        >
          <Phone className="size-4" />
          {t("phone.reveal.signin")}
        </a>
        <p className="text-xs text-[var(--muted-foreground)] text-center px-2">
          {t("phone.reveal.signinHint")}
        </p>
      </div>
    );
  }

  if (contact?.phone) {
    const telHref = `tel:${contact.phone.replace(/[^\d+]/g, "")}`;
    return (
      <div className="space-y-2">
        <a
          href={telHref}
          className={
            baseClasses +
            " bg-emerald-700 hover:bg-emerald-800 text-white"
          }
        >
          <Phone className="size-4" />
          {formatPhone(contact.phone)}
        </a>
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="text-xs text-[var(--primary)] hover:underline block text-center"
          >
            {contact.email}
          </a>
        )}
      </div>
    );
  }

  async function handleReveal() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/listings/${listingId}/contact`, {
        method: "POST",
      });
      if (!resp.ok) {
        if (resp.status === 401) {
          const next = encodeURIComponent(`/listings/${listingId}`);
          window.location.href = `/?auth=required&next=${next}`;
          return;
        }
        const data = await resp.json().catch(() => ({}));
        setError(data?.error ?? `HTTP ${resp.status}`);
        return;
      }
      const data = (await resp.json()) as RevealedContact;
      if (!data.phone) {
        setError("no_phone");
        return;
      }
      setContact(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }

  if (error === "no_phone" && sourceUrl) {
    return (
      <div className="space-y-2">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={
            baseClasses + " bg-emerald-700 hover:bg-emerald-800 text-white"
          }
        >
          <Phone className="size-4" />
          {t("phone.reveal.atSource")}
        </a>
        <p className="text-xs text-[var(--muted-foreground)] text-center px-2">
          {t("phone.reveal.atSourceHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleReveal}
        disabled={loading}
        className={
          baseClasses +
          " bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-60"
        }
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Phone className="size-4" />
        )}
        {loading ? t("phone.reveal.loading") : t("phone.reveal.locked")}
      </button>
      {error && error !== "no_phone" && (
        <p className="text-xs text-[var(--destructive)] text-center px-2">
          {t("phone.reveal.errorPrefix")}: {error}
        </p>
      )}
      <p className="text-xs text-[var(--muted-foreground)] text-center px-2">
        {t("phone.reveal.sourceLabel")}: {sourceLabel(source)}
      </p>
    </div>
  );
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("357") && digits.length === 11) {
    return `+357 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return raw.startsWith("+") ? raw : `+${digits}`;
}

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

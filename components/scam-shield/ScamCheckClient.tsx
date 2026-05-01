"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ScoreLight } from "@/components/scam-shield/ScoreLight";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type Verdict = "clean" | "warn" | "high";
type Kind = "text" | "url" | "image";

type ScamCheckResponse = {
  id: string | null;
  score: number;
  verdict: Verdict;
  flags: string[];
  explanation_md: string;
  similar_listing_ids: string[];
  extracted: Record<string, unknown> | null;
  remaining_quota: number | null;
  tier: string;
};

type ErrorResponse = { error: string; reason?: string; reset_at?: string; phase?: string };

const TABS: { kind: Kind; key: TKey; icon: string }[] = [
  { kind: "text", key: "scc.tab.text", icon: "✍️" },
  { kind: "url", key: "scc.tab.url", icon: "🔗" },
  { kind: "image", key: "scc.tab.image", icon: "📷" },
];

const FLAG_KEY: Record<string, TKey> = {
  price_anomaly_low: "scamFlag.price_anomaly_low",
  price_implausible: "scamFlag.price_implausible",
  no_phone: "scamFlag.no_phone",
  known_scam_phone: "scamFlag.known_scam_phone",
  duplicate_images: "scamFlag.duplicate_images",
  text_scam_markers: "scamFlag.text_scam_markers",
  low_evidence: "scamFlag.low_evidence",
};

const SIGNAL_KEY: Record<string, TKey> = {
  urgent_pressure: "scc.signal.urgent_pressure",
  deposit_before_viewing: "scc.signal.deposit_before_viewing",
  cash_only: "scc.signal.cash_only",
  remote_landlord: "scc.signal.remote_landlord",
  no_viewing: "scc.signal.no_viewing",
  excessive_emojis: "scc.signal.excessive_emojis",
  broken_grammar: "scc.signal.broken_grammar",
  stock_phrases: "scc.signal.stock_phrases",
  watermark_visible: "scc.signal.watermark_visible",
  branding_visible: "scc.signal.branding_visible",
  cropped_to_hide_watermark: "scc.signal.cropped_to_hide_watermark",
  image_blurry: "scc.signal.image_blurry",
};

const REPORT_REASONS: Array<{ id: string; key: TKey }> = [
  { id: "fake_address", key: "scc.report.reason.fake_address" },
  { id: "unreliable_provider", key: "scc.report.reason.unreliable_provider" },
  { id: "stolen_images", key: "scc.report.reason.stolen_images" },
  { id: "money_before_viewing", key: "scc.report.reason.money_before_viewing" },
  { id: "fake_id_papers", key: "scc.report.reason.fake_id_papers" },
  { id: "other", key: "scc.report.reason.other" },
];

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function ScamCheckClient() {
  const { t } = useT();
  const [kind, setKind] = useState<Kind>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [imageConverting, setImageConverting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScamCheckResponse | null>(null);
  const [error, setError] = useState<ErrorResponse | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let resp: Response;
      if (kind === "image") {
        if (!imageFile) return;
        const fd = new FormData();
        fd.append("file", imageFile);
        resp = await fetch("/api/scam-check", { method: "POST", body: fd });
      } else {
        const body = kind === "text" ? { kind: "text", text } : { kind: "url", url };
        resp = await fetch("/api/scam-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const data = await resp.json();
      if (!resp.ok) {
        setError(data as ErrorResponse);
      } else {
        setResult(data as ScamCheckResponse);
      }
    } catch (err) {
      setError({ error: "network_error", reason: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChosen(file: File | null) {
    if (!file) {
      setImageFile(null);
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError({ error: "file_too_large", reason: t("scc.image.tooLarge") });
      return;
    }
    setError(null);

    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.(heic|heif)$/i.test(file.name);
    if (isHeic) {
      setImageConverting(true);
      try {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        const jpegFile = new File(
          [jpegBlob],
          file.name.replace(/\.(heic|heif)$/i, ".jpg"),
          { type: "image/jpeg" },
        );
        if (jpegFile.size > IMAGE_MAX_BYTES) {
          setError({ error: "file_too_large", reason: t("scc.image.heicTooLarge") });
          setImageFile(null);
        } else {
          setImageFile(jpegFile);
        }
      } catch (err) {
        console.error("[scam-shield] heic conversion failed", err);
        setError({ error: "heic_conversion_failed", reason: t("scc.image.heicFailed") });
        setImageFile(null);
      } finally {
        setImageConverting(false);
      }
      return;
    }

    if (!IMAGE_ALLOWED.includes(file.type)) {
      setError({ error: "unsupported_mime", reason: t("scc.image.unsupported") });
      return;
    }
    setImageFile(file);
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  const canSubmit =
    !loading &&
    ((kind === "text" && text.trim().length >= 30) ||
      (kind === "url" && /^https?:\/\//.test(url.trim())) ||
      (kind === "image" && imageFile !== null));

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {!result && !error && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex gap-2 border-b pb-3">
              {TABS.map((tab) => (
                <button
                  key={tab.kind}
                  type="button"
                  onClick={() => setKind(tab.kind)}
                  className={cn(
                    "px-3 py-2 text-sm rounded-md transition-colors",
                    kind === tab.kind
                      ? "bg-[var(--brand-navy)] text-white"
                      : "hover:bg-[var(--brand-gold-50)] text-[var(--foreground)]",
                  )}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {t(tab.key)}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3">
              {kind === "text" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    {t("scc.text.label")}
                  </label>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("scc.text.placeholder")}
                    className="min-h-[200px]"
                    maxLength={10_000}
                  />
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {tFormat(t("scc.text.charCount"), { n: text.length })}
                  </p>
                </>
              )}

              {kind === "url" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    {t("scc.url.label")}
                  </label>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("scc.url.placeholder")}
                  />
                  <p className="text-xs text-[var(--muted-foreground)]">{t("scc.url.hint")}</p>
                </>
              )}

              {kind === "image" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    {t("scc.image.label")}
                  </label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setImageDragOver(true);
                    }}
                    onDragLeave={() => setImageDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setImageDragOver(false);
                      const f = e.dataTransfer.files?.[0] ?? null;
                      handleFileChosen(f);
                    }}
                    className={cn(
                      "border-2 border-dashed rounded-md p-8 text-center transition-colors",
                      imageDragOver
                        ? "border-[var(--brand-gold)] bg-[var(--brand-gold-50)]"
                        : "border-[var(--border)] bg-transparent",
                      imageFile && "border-emerald-300 bg-emerald-50",
                    )}
                  >
                    {imageConverting ? (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {t("scc.image.heicConverting")}
                      </p>
                    ) : imageFile ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">📎 {imageFile.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {(imageFile.size / 1024).toFixed(0)} KB · {imageFile.type}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleFileChosen(null)}
                          className="text-xs underline text-[var(--muted-foreground)]"
                        >
                          {t("scc.image.chooseOther")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm">{t("scc.image.dragHere")}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{t("scc.image.or")}</p>
                        <label className="inline-block px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-[var(--brand-gold-50)] cursor-pointer">
                          {t("scc.image.selectFile")}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                            className="hidden"
                            onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {t("scc.image.afterText")}
                  </p>
                </>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("scc.privacy")}{" "}
                  <a
                    href="/datenschutz#scam-shield"
                    className="underline hover:no-underline"
                  >
                    {t("scc.privacy.more")}
                  </a>
                </p>
                <Button type="submit" disabled={!canSubmit}>
                  {loading ? t("scc.submit.busy") : t("scc.submit.go")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {error && <ErrorCard error={error} onRetry={reset} t={t} />}

      {result && <ResultCard result={result} onRetry={reset} t={t} />}
    </div>
  );
}

function ResultCard({
  result,
  onRetry,
  t,
}: {
  result: ScamCheckResponse;
  onRetry: () => void;
  t: T;
}) {
  const v = result.verdict;
  const flagCount = result.flags.length;
  const colors =
    v === "high"
      ? { bg: "bg-red-50", border: "border-red-300", text: "text-red-900", icon: "🚨" }
      : v === "warn"
      ? { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", icon: "⚠️" }
      : flagCount === 0
      ? { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", icon: "✅" }
      : { bg: "bg-emerald-50/70", border: "border-emerald-200", text: "text-emerald-900", icon: "💡" };

  const heading =
    v === "high"
      ? t("scc.result.high")
      : v === "warn"
      ? t("scc.result.warn")
      : flagCount === 0
      ? t("scc.result.cleanNoFlags")
      : t("scc.result.cleanWithFlags");

  const subline =
    v === "high"
      ? t("scc.result.subHigh")
      : v === "warn"
      ? t("scc.result.subWarn")
      : flagCount === 0
      ? t("scc.result.subCleanNoFlags")
      : t("scc.result.subCleanWithFlags");

  const qualitySignals = Array.isArray(
    (result.extracted as Record<string, unknown>)?.quality_signals,
  )
    ? ((result.extracted as { quality_signals: string[] }).quality_signals)
    : [];

  return (
    <div className="space-y-4">
      <Card className={cn(colors.border, "border-2")}>
        <CardContent className={cn(colors.bg, "rounded-lg p-6 space-y-5")}>
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">{colors.icon}</span>
            <div className={cn("flex-1", colors.text)}>
              <h2 className="text-xl font-semibold">{heading}</h2>
              <p className="text-sm opacity-80 mt-1">{subline}</p>
            </div>
          </div>

          <ScoreLight
            verdict={v}
            score={result.score}
            labels={{
              clean: t("scoreLight.clean"),
              warn: t("scoreLight.warn"),
              high: t("scoreLight.high"),
              scoreLine: t("scoreLight.line"),
            }}
          />

          {flagCount > 0 && (
            <ul className="space-y-2">
              {result.flags.map((f) => (
                <li key={f} className={cn("text-sm", colors.text)}>
                  <div className="flex items-start gap-2">
                    <span className="opacity-60 mt-0.5">•</span>
                    <span className="font-medium">{FLAG_KEY[f] ? t(FLAG_KEY[f]) : f}</span>
                  </div>
                  {f === "text_scam_markers" && qualitySignals.length > 0 && (
                    <ul className="mt-1 ml-5 space-y-0.5 text-xs opacity-80">
                      {qualitySignals.map((s) => (
                        <li key={s} className="flex items-start gap-1.5">
                          <span>›</span>
                          <span>{SIGNAL_KEY[s] ? t(SIGNAL_KEY[s]) : s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="text-sm">
            <summary className={cn("cursor-pointer font-medium select-none", colors.text)}>
              {t("scc.result.explanation")}
            </summary>
            <div className={cn("mt-2 space-y-1.5 text-sm", colors.text)}>
              {renderExplanation(result.explanation_md)}
            </div>
          </details>

          {result.similar_listing_ids.length > 0 && (
            <div className="pt-2 border-t border-current/10">
              <p className={cn("text-sm font-medium mb-2", colors.text)}>
                {t("scc.result.similar")}
              </p>
              <ul className="space-y-1">
                {result.similar_listing_ids.slice(0, 3).map((id) => (
                  <li key={id} className="text-sm">
                    <a
                      href={`/listings/${id}`}
                      className={cn("underline hover:no-underline", colors.text)}
                    >
                      → {t("scc.result.listingShort")} {id.slice(0, 8)}…
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.id && (v === "warn" || v === "high") && (
            <div className="pt-2 border-t border-current/10">
              <ReportButton checkId={result.id} colorText={colors.text} t={t} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 flex items-center justify-between gap-4">
          <p className="text-sm">
            {v === "clean" ? t("scc.result.cta.searchOwn") : t("scc.result.cta.helpReal")}
            <br />
            <span className="text-[var(--muted-foreground)]">
              {t("scc.result.cta.subline")}
            </span>
          </p>
          <a
            href="/chat"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-navy)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--brand-navy-700)]"
          >
            {t("scc.result.cta.go")}
          </a>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] px-2">
        <span>
          {result.remaining_quota != null
            ? result.remaining_quota === 1
              ? t("scc.result.quotaRemainingOne")
              : tFormat(t("scc.result.quotaRemaining"), { n: result.remaining_quota })
            : t("scc.result.quotaPremium")}
        </span>
        <button onClick={onRetry} className="underline hover:no-underline">
          {t("scc.result.again")}
        </button>
      </div>
    </div>
  );
}

function renderExplanation(md: string): ReactNode[] {
  const lines = md.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    let body = line.replace(/^([-*])\s+/, "• ");
    body = body.trim();
    const parts = body.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i}>
        {parts.map((part, j) => {
          const m = /^\*\*([^*]+)\*\*$/.exec(part);
          if (m) return <strong key={j}>{m[1]}</strong>;
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}

function ReportButton({
  checkId,
  colorText,
  t,
}: {
  checkId: string;
  colorText: string;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);

  if (reported) {
    return (
      <p className={cn("text-sm font-medium", colorText)}>
        {t("scc.report.thanks")}
      </p>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "text-sm underline font-medium hover:no-underline",
          colorText,
        )}
      >
        {t("scc.report.cta")}
      </button>
      {open && (
        <ReportModal
          checkId={checkId}
          onClose={() => setOpen(false)}
          onReported={() => {
            setReported(true);
            setOpen(false);
          }}
          t={t}
        />
      )}
    </>
  );
}

function ReportModal({
  checkId,
  onClose,
  onReported,
  t,
}: {
  checkId: string;
  onClose: () => void;
  onReported: () => void;
  t: T;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) {
      setErr(t("scc.report.atLeastOne"));
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/scam-check/${checkId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasons: Array.from(selected) }),
      });
      if (resp.ok) {
        onReported();
      } else {
        const data = await resp.json().catch(() => null);
        setErr(data?.reason ?? data?.error ?? t("scc.report.couldNot"));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card)] rounded-lg shadow-lg max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">{t("scc.report.title")}</h3>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {t("scc.report.subtitle")}
          </p>
        </div>

        <div className="space-y-2">
          {REPORT_REASONS.map((r) => (
            <label
              key={r.id}
              className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-[var(--brand-gold-50)]"
            >
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                className="mt-0.5"
              />
              <span className="text-sm">{t(r.key)}</span>
            </label>
          ))}
        </div>

        {err && <p className="text-sm text-red-700">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t("scc.report.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting || selected.size === 0}>
            {submitting ? t("scc.report.submitting") : t("scc.report.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({
  error,
  onRetry,
  t,
}: {
  error: ErrorResponse;
  onRetry: () => void;
  t: T;
}) {
  const headline =
    error.error === "quota_exhausted"
      ? t("scc.err.quota_exhausted")
      : error.error === "input_too_short"
      ? t("scc.err.input_too_short")
      : error.error === "input_unparseable"
      ? t("scc.err.input_unparseable")
      : error.error === "url_not_whitelisted"
      ? t("scc.err.url_not_whitelisted")
      : error.error === "url_not_in_index"
      ? t("scc.err.url_not_in_index")
      : error.error === "not_implemented"
      ? t("scc.err.not_implemented")
      : t("scc.err.fallback");

  let detail: string;
  if (error.error === "quota_exhausted") {
    let s = t("scc.errd.quota_exhausted");
    if (error.reset_at) {
      s += ` ${tFormat(t("scc.errd.quota_resetAt"), { date: new Date(error.reset_at).toLocaleDateString() })}`;
    }
    detail = s;
  } else if (error.error === "input_too_short") {
    detail = t("scc.errd.input_too_short");
  } else if (error.error === "input_unparseable") {
    detail = t("scc.errd.input_unparseable");
  } else if (error.error === "url_not_in_index") {
    detail = t("scc.errd.url_not_in_index");
  } else if (error.error === "url_not_whitelisted") {
    detail = t("scc.errd.url_not_whitelisted");
  } else if (error.error === "not_implemented") {
    detail = tFormat(t("scc.errd.not_implemented"), { phase: error.phase ?? "B" });
  } else {
    detail = error.reason ?? t("scc.errd.unknown");
  }

  return (
    <Card className="border-amber-200">
      <CardContent className="p-6 space-y-3">
        <h2 className="font-semibold">{headline}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{detail}</p>
        <Button variant="outline" onClick={onRetry}>
          {t("scc.err.tryAgain")}
        </Button>
      </CardContent>
    </Card>
  );
}

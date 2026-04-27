"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

const TABS: { kind: Kind; label: string; icon: string; available: boolean; hint?: string }[] = [
  { kind: "text", label: "Text einfügen", icon: "✍️", available: true },
  { kind: "url", label: "URL einkippen", icon: "🔗", available: true },
  { kind: "image", label: "Screenshot", icon: "📷", available: true },
];

const FLAG_LABELS: Record<string, string> = {
  price_anomaly_low: "Preis ungewöhnlich niedrig",
  price_implausible: "Preis unplausibel",
  no_phone: "Keine Telefonnummer",
  known_scam_phone: "Bekannte Scam-Nummer",
  duplicate_images: "Bilder mehrfach verwendet",
  text_scam_markers: "Verdächtige Formulierungen",
  low_evidence: "Wenig Vergleichsdaten",
};

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function ScamCheckClient() {
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
      setError({ error: "file_too_large", reason: "Maximal 10 MB pro Bild." });
      return;
    }
    setError(null);

    // iPhone-Fotos kommen als HEIC — Anthropic-Vision unterstützt das nicht.
    // Konvertieren wir clientseitig zu JPEG mit heic2any (~1MB Lib, lazy load).
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.(heic|heif)$/i.test(file.name);
    if (isHeic) {
      setImageConverting(true);
      try {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
        // heic2any returns Blob | Blob[]; bei multi-frame nehmen wir das erste
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        const jpegFile = new File(
          [jpegBlob],
          file.name.replace(/\.(heic|heif)$/i, ".jpg"),
          { type: "image/jpeg" },
        );
        if (jpegFile.size > IMAGE_MAX_BYTES) {
          setError({
            error: "file_too_large",
            reason: "Konvertiertes JPEG ist über 10 MB. Wähle ein kleineres Bild.",
          });
          setImageFile(null);
        } else {
          setImageFile(jpegFile);
        }
      } catch (err) {
        console.error("[scam-shield] heic conversion failed", err);
        setError({
          error: "heic_conversion_failed",
          reason: "Konnte das HEIC-Bild nicht konvertieren. Speichere es vorher als JPEG.",
        });
        setImageFile(null);
      } finally {
        setImageConverting(false);
      }
      return;
    }

    if (!IMAGE_ALLOWED.includes(file.type)) {
      setError({ error: "unsupported_mime", reason: "JPEG, PNG oder WebP (HEIC wird automatisch konvertiert)." });
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
                  onClick={() => tab.available && setKind(tab.kind)}
                  disabled={!tab.available}
                  className={cn(
                    "px-3 py-2 text-sm rounded-md transition-colors",
                    kind === tab.kind && tab.available
                      ? "bg-[var(--brand-navy)] text-white"
                      : "hover:bg-[var(--brand-gold-50)] text-[var(--foreground)]",
                    !tab.available && "opacity-50 cursor-not-allowed",
                  )}
                  title={tab.hint}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3">
              {kind === "text" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    Inseratstext einfügen — z.B. aus WhatsApp, Telegram oder einer FB-Gruppe.
                  </label>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="🔥 Schöne 2-Zimmer-Wohnung in Limassol, 600€/Monat..."
                    className="min-h-[200px]"
                    maxLength={10_000}
                  />
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {text.length}/10.000 Zeichen · mindestens 30 zum Prüfen
                  </p>
                </>
              )}

              {kind === "url" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    Link zum Inserat — Bazaraki oder Facebook-Permalink.
                  </label>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.bazaraki.com/adv/123456_..."
                  />
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Wir prüfen zuerst unseren eigenen Index — dort stehen schon{" "}
                    <strong>500+</strong> Inserate aus Zypern. Wenn dein Inserat dort ist, bekommst
                    du sofort einen Score.
                  </p>
                </>
              )}

              {kind === "image" && (
                <>
                  <label className="text-sm text-[var(--muted-foreground)]">
                    Screenshot des Inserats hochladen — JPEG, PNG oder WebP, max. 10 MB.
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
                        🔄 HEIC wird zu JPEG konvertiert…
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
                          Anderes Bild wählen
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm">📷 Bild hier reinziehen</p>
                        <p className="text-xs text-[var(--muted-foreground)]">oder</p>
                        <label className="inline-block px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-[var(--brand-gold-50)] cursor-pointer">
                          Datei auswählen
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
                    Funktioniert auch mit Mobile-Screenshots aus FB-Groups oder Telegram. Nach der
                    Prüfung wird das Bild verworfen — nur ein Bild-Hash bleibt für künftige
                    Cross-Matches.
                  </p>
                </>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-[var(--muted-foreground)]">
                  Wir verarbeiten dein Inserat nur für die Prüfung. Verschlüsselt 30 Tage
                  gespeichert, dann automatisch gelöscht.
                </p>
                <Button type="submit" disabled={!canSubmit}>
                  {loading ? "Sophie schaut sich das an…" : "Sophie prüfen lassen"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {error && <ErrorCard error={error} onRetry={reset} />}

      {result && <ResultCard result={result} onRetry={reset} />}
    </div>
  );
}

// ---------- Result-Card ------------------------------------------------------

function ResultCard({
  result,
  onRetry,
}: {
  result: ScamCheckResponse;
  onRetry: () => void;
}) {
  const v = result.verdict;
  const colors =
    v === "high"
      ? { bg: "bg-red-50", border: "border-red-300", text: "text-red-900", icon: "🚨" }
      : v === "warn"
      ? { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", icon: "⚠️" }
      : { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", icon: "✅" };
  const heading =
    v === "high"
      ? "Deutliche Warnung"
      : v === "warn"
      ? "Verdächtig"
      : "Keine deutlichen Scam-Signale";

  const lines = result.explanation_md.split("\n").filter((l) => l.trim().length > 0);

  return (
    <div className="space-y-4">
      <Card className={cn(colors.border, "border-2")}>
        <CardContent className={cn(colors.bg, "rounded-lg p-6 space-y-4")}>
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">{colors.icon}</span>
            <div className={cn("flex-1", colors.text)}>
              <h2 className="text-xl font-semibold">{heading}</h2>
              <p className="text-sm opacity-80 mt-1">
                Score {result.score.toFixed(2)} / 1.00 ·{" "}
                {result.flags.length === 0
                  ? "keine Hinweise"
                  : `${result.flags.length} ${result.flags.length === 1 ? "Hinweis" : "Hinweise"}`}
              </p>
            </div>
          </div>

          {result.flags.length > 0 && (
            <ul className="space-y-1 pl-2">
              {result.flags.map((f) => (
                <li key={f} className={cn("text-sm flex items-start gap-2", colors.text)}>
                  <span className="opacity-60">•</span>
                  <span className="font-medium">{FLAG_LABELS[f] ?? f}</span>
                </li>
              ))}
            </ul>
          )}

          <details className="text-sm">
            <summary className={cn("cursor-pointer font-medium", colors.text)}>
              Sophies Erklärung anzeigen
            </summary>
            <div className={cn("mt-2 space-y-1.5 text-sm", colors.text)}>
              {lines.map((line, i) => (
                <p key={i}>{line.replace(/^[-*]\s*/, "• ")}</p>
              ))}
            </div>
          </details>

          {result.similar_listing_ids.length > 0 && (
            <div className="pt-2 border-t border-current/10">
              <p className={cn("text-sm font-medium mb-2", colors.text)}>
                Ähnliche Inserate gefunden:
              </p>
              <ul className="space-y-1">
                {result.similar_listing_ids.slice(0, 3).map((id) => (
                  <li key={id} className="text-sm">
                    <a
                      href={`/listings/${id}`}
                      className={cn("underline hover:no-underline", colors.text)}
                    >
                      → Inserat {id.slice(0, 8)}…
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 flex items-center justify-between gap-4">
          <p className="text-sm">
            {v === "clean"
              ? "Suchst du selbst eine Wohnung?"
              : "Sophie hilft dir, ein echtes Inserat zu finden."}
            <br />
            <span className="text-[var(--muted-foreground)]">
              Im Chat erstellt sie dir ein Suchprofil und durchsucht 500+ Inserate.
            </span>
          </p>
          <a
            href="/chat"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-navy)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--brand-navy-700)]"
          >
            Mit Sophie chatten →
          </a>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] px-2">
        <span>
          {result.remaining_quota != null
            ? `Du hast diesen Monat noch ${result.remaining_quota} kostenlose Checks.`
            : "Premium · unbegrenzt"}
        </span>
        <button onClick={onRetry} className="underline hover:no-underline">
          Noch ein Inserat prüfen
        </button>
      </div>
    </div>
  );
}

// ---------- Error-Card -------------------------------------------------------

function ErrorCard({ error, onRetry }: { error: ErrorResponse; onRetry: () => void }) {
  const headline =
    error.error === "quota_exhausted"
      ? "Free-Quota erschöpft"
      : error.error === "input_too_short"
      ? "Text zu kurz"
      : error.error === "input_unparseable"
      ? "Konnte kein Inserat erkennen"
      : error.error === "url_not_whitelisted"
      ? "Quelle nicht unterstützt"
      : error.error === "url_not_in_index"
      ? "Inserat noch nicht im Index"
      : error.error === "not_implemented"
      ? "Noch nicht verfügbar"
      : "Sophie konnte das nicht prüfen";

  const detail =
    error.error === "quota_exhausted"
      ? `Du hast deine 3 kostenlosen Checks für diesen Monat genutzt. Premium für 9,90 €/M → unbegrenzt.${
          error.reset_at ? ` Dein nächster freier Check: ${new Date(error.reset_at).toLocaleDateString("de-DE")}.` : ""
        }`
      : error.error === "input_too_short"
      ? "Bitte mindestens 30 Zeichen eingeben."
      : error.error === "input_unparseable"
      ? "Sophie konnte keinen Immobilien-Inseratstext darin finden."
      : error.error === "url_not_in_index"
      ? "Wir haben das Inserat noch nicht in unserem Index. Lade einen Screenshot hoch oder paste den Text rein."
      : error.error === "url_not_whitelisted"
      ? "Wir prüfen aktuell nur Bazaraki- und Facebook-Permalinks."
      : error.error === "not_implemented"
      ? `Diese Option kommt in Phase ${error.phase ?? "B-folgend"}. Probier solange einen anderen Tab.`
      : (error.reason ?? "Unbekannter Fehler.");

  return (
    <Card className="border-amber-200">
      <CardContent className="p-6 space-y-3">
        <h2 className="font-semibold">{headline}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{detail}</p>
        <Button variant="outline" onClick={onRetry}>
          Nochmal versuchen
        </Button>
      </CardContent>
    </Card>
  );
}

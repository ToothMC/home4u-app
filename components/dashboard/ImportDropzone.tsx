"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T } from "@/lib/i18n/dict";

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type FieldError = { field: string; value: string | null; reason: string };

type Item =
  | {
      status: "valid";
      sourceIndex: number;
      normalized: NormalizedView;
      confidence: number;
      note?: string;
    }
  | {
      status: "error";
      sourceIndex: number;
      errors: FieldError[];
      raw: Record<string, unknown>;
      confidence: number;
      note?: string;
    }
  | {
      status: "duplicate-in-file";
      sourceIndex: number;
      normalized: NormalizedView;
      confidence: number;
      note?: string;
    };

type NormalizedView = {
  type: "rent" | "sale";
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number;
  size_sqm: number | null;
  contact_phone: string | null;
  contact_name: string | null;
  external_id: string | null;
  media: string[];
  language: string | null;
};

type PreviewResponse = {
  fileName: string;
  inputFormat: string;
  inputKind: "rows" | "text";
  fileSignature: string;
  summary: { total: number; valid: number; errors: number; duplicatesInFile: number };
  items: Item[];
  previewToken: string | null;
  aiUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

type State =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "preview"; data: PreviewResponse }
  | { kind: "committing" }
  | {
      kind: "done";
      result: { importId: string; inserted: number; updated: number; failed: { index: number; reason: string }[] };
    }
  | { kind: "error"; message: string };

const ACCEPT = ".csv,.tsv,.xlsx,.xlsm,.pdf,.txt,.md,.text";

export function ImportDropzone() {
  const router = useRouter();
  const { t, lang } = useT();
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const [dragActive, setDragActive] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState({ kind: "uploading", fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/listings/import/preview", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: detail.detail ?? detail.error ?? tFormat(t("import.uploadFailed"), { code: res.status }),
        });
        return;
      }
      const data: PreviewResponse = await res.json();
      setState({ kind: "preview", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : t("btn.networkError"),
      });
    }
  }

  async function commit() {
    if (state.kind !== "preview" || !state.data.previewToken) return;
    const token = state.data.previewToken;
    const fileName = state.data.fileName;
    setState({ kind: "committing" });
    try {
      const res = await fetch("/api/listings/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewToken: token, fileName }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: detail.detail ?? detail.error ?? tFormat(t("import.failed"), { code: res.status }),
        });
        return;
      }
      const result = await res.json();
      setState({ kind: "done", result });
      router.refresh();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : t("btn.networkError"),
      });
    }
  }

  function reset() {
    setState({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  if (state.kind === "done") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <CheckCircle2 className="size-12 text-green-600 mx-auto" />
          <div>
            <h2 className="text-lg font-semibold">{t("import.done")}</h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              {tFormat(t("import.doneSummary"), { a: state.result.inserted, b: state.result.updated })}
              {state.result.failed.length > 0
                ? tFormat(t("import.doneErrors"), { n: state.result.failed.length })
                : ""}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button asChild>
              <Link href="/dashboard?view=provider">{t("import.toDashboard")}</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              {t("import.uploadAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <div className="flex items-start gap-2 text-red-600">
            <AlertCircle className="size-5 mt-0.5 shrink-0" />
            <div>
              <strong>{t("import.errorPrefix")}:</strong> {state.message}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            {t("import.tryAgain")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "preview") {
    return (
      <PreviewView
        data={state.data}
        onCommit={commit}
        onCancel={reset}
        onDownloadErrors={() => downloadErrorFile(state.data)}
        t={t}
        lang={lang}
      />
    );
  }

  if (state.kind === "uploading" || state.kind === "committing") {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Loader2 className="size-10 mx-auto animate-spin text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            {state.kind === "uploading"
              ? t("import.uploadingFile")
              : t("import.committing")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "transition-colors",
        dragActive && "border-[var(--primary)] bg-[var(--accent)]"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <CardContent
        className="py-16 text-center cursor-pointer space-y-3"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-10 mx-auto text-[var(--muted-foreground)]" />
        <div>
          <p className="font-medium">{t("import.dropHere")}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {t("import.dropHint")}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </CardContent>
    </Card>
  );
}

function PreviewView({
  data,
  onCommit,
  onCancel,
  onDownloadErrors,
  t,
  lang,
}: {
  data: PreviewResponse;
  onCommit: () => void;
  onCancel: () => void;
  onDownloadErrors: () => void;
  t: T;
  lang: string;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-[var(--muted-foreground)]" />
            <div>
              <div className="font-medium">{data.fileName}</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {tFormat(t("import.rowsFormat"), { n: data.summary.total, format: data.inputFormat.toUpperCase() })}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="size-4" /> {t("import.cancel")}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <SummaryTile label={t("import.summary.valid")} value={data.summary.valid} tone="ok" />
        <SummaryTile
          label={t("import.summary.errors")}
          value={data.summary.errors}
          tone={data.summary.errors > 0 ? "warn" : "muted"}
        />
        <SummaryTile
          label={t("import.summary.duplicates")}
          value={data.summary.duplicatesInFile}
          tone="muted"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="bg-[var(--accent)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)]">
          {tFormat(t("import.previewHeading"), { n: Math.min(data.items.length, 50) })}
        </div>
        <div className="divide-y max-h-[420px] overflow-y-auto">
          {data.items.slice(0, 50).map((item) => (
            <ItemRow key={item.sourceIndex} item={item} t={t} lang={lang} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        {data.summary.errors > 0 && (
          <Button variant="outline" size="sm" onClick={onDownloadErrors}>
            {t("import.downloadErrors")}
          </Button>
        )}
        <Button
          onClick={onCommit}
          disabled={!data.previewToken || data.summary.valid === 0}
        >
          {data.summary.valid === 0
            ? t("import.commit.none")
            : data.summary.valid === 1
              ? t("import.commit.one")
              : tFormat(t("import.commit.many"), { n: data.summary.valid })}
        </Button>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "ok" && "border-green-200 bg-green-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "muted" && "bg-[var(--accent)]"
      )}
    >
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}

function ItemRow({ item, t, lang }: { item: Item; t: T; lang: string }) {
  if (item.status === "valid" || item.status === "duplicate-in-file") {
    const n = item.normalized;
    return (
      <div className="px-3 py-2 text-sm flex items-start gap-2">
        <span
          className={cn(
            "inline-block size-2 rounded-full mt-2 shrink-0",
            item.status === "valid" ? "bg-green-500" : "bg-gray-400"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {n.type === "rent" ? t("import.rentLabel") : t("import.saleLabel")} · {n.location_city}
            {n.location_district ? ` · ${n.location_district}` : ""} · {n.rooms}{" "}
            {t("matchCard.roomsShort")} · {n.price.toLocaleString(NUMBER_LOCALE[lang] ?? "en-GB")} {n.currency}
            {n.size_sqm ? ` · ${n.size_sqm} m²` : ""}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] truncate">
            {item.status === "duplicate-in-file" && (
              <span className="text-amber-700">{t("import.dupLabel")} · </span>
            )}
            {n.contact_name ?? ""}
            {n.contact_phone ? ` · ${n.contact_phone}` : ""}
            {n.external_id ? ` · #${n.external_id}` : ""}
            {n.media.length > 0 ? ` · ${tFormat(t("import.imagesCount"), { n: n.media.length })}` : ""}
            {item.confidence < 0.9 ? ` · ${tFormat(t("import.confidence"), { pct: Math.round(item.confidence * 100) })}` : ""}
            {item.note ? ` · ${item.note}` : ""}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 py-2 text-sm flex items-start gap-2 bg-red-50/40">
      <AlertCircle className="size-4 text-red-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-red-900">{tFormat(t("import.rowError"), { n: item.sourceIndex + 1 })}</div>
        <ul className="text-xs text-red-800 mt-0.5 space-y-0.5">
          {item.errors.map((e, idx) => (
            <li key={idx}>
              <strong>{e.field}:</strong> {e.reason}
              {e.value ? ` — "${e.value}"` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function downloadErrorFile(data: PreviewResponse) {
  const errorItems = data.items.filter((i) => i.status === "error");
  if (errorItems.length === 0) return;
  const allKeys = new Set<string>();
  errorItems.forEach((item) => {
    if (item.status !== "error") return;
    Object.keys(item.raw ?? {}).forEach((k) => allKeys.add(k));
  });
  const keys = Array.from(allKeys);
  const header = [...keys, "_errors"];
  const lines = [header.map(csvEscape).join(",")];
  for (const item of errorItems) {
    if (item.status !== "error") continue;
    const row = keys.map((k) => csvEscape(String(item.raw[k] ?? "")));
    row.push(csvEscape(item.errors.map((e) => `${e.field}: ${e.reason}`).join(" | ")));
    lines.push(row.join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.fileName.replace(/\.[^.]+$/, "")}_fehler.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

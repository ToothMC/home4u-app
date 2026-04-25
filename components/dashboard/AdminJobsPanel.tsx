"use client";

import * as React from "react";
import { Loader2, Play, MapPin, Sparkles, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type JobConfig = {
  key: string;
  label: string;
  endpoint: string;
  icon: React.ReactNode;
  description: string;
  /** Default-Limit pro Run */
  limit: number;
  /** Max Iteration für Schutz */
  maxRuns: number;
};

const JOBS: JobConfig[] = [
  {
    key: "geocode",
    label: "Geocoding (Nominatim)",
    endpoint: "/api/admin/geocode-backfill",
    icon: <MapPin className="size-4" />,
    description:
      "Listings ohne lat/lng bekommen Koordinaten zugewiesen. Dauert ~33 Sek pro 30 Listings (Nominatim-Rate-Limit).",
    limit: 30,
    maxRuns: 20,
  },
  {
    key: "embed",
    label: "Embeddings (OpenAI)",
    endpoint: "/api/admin/embed-backfill",
    icon: <Sparkles className="size-4" />,
    description:
      "Listings + Suchprofile ohne Embedding werden via text-embedding-3-small vektorisiert (für Cosine-Match).",
    limit: 200,
    maxRuns: 5,
  },
];

type RunState = "idle" | "running" | "done" | "error";

type RunResult = {
  state: RunState;
  log: string[];
  totalProcessed: number;
  totalHits: number;
  error: string | null;
};

export function AdminJobsPanel() {
  const [runs, setRuns] = React.useState<Record<string, RunResult>>(() => {
    const m: Record<string, RunResult> = {};
    JOBS.forEach((j) => (m[j.key] = init()));
    return m;
  });

  function init(): RunResult {
    return { state: "idle", log: [], totalProcessed: 0, totalHits: 0, error: null };
  }

  async function runJob(job: JobConfig) {
    setRuns((p) => ({ ...p, [job.key]: { ...init(), state: "running" } }));

    let totalProcessed = 0;
    let totalHits = 0;

    for (let i = 0; i < job.maxRuns; i++) {
      try {
        const res = await fetch(`${job.endpoint}?limit=${job.limit}`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || data.ok === false) {
          setRuns((p) => ({
            ...p,
            [job.key]: {
              ...p[job.key],
              state: "error",
              error: data.detail ?? data.error ?? `HTTP ${res.status}`,
            },
          }));
          return;
        }

        // Geocoding-Format: { processed, hits, misses }
        // Embed-Format:     { listings: { processed, embedded }, profiles: { ... } }
        let processed = 0;
        let hits = 0;
        if (typeof data.processed === "number") {
          processed = data.processed;
          hits = data.hits ?? 0;
        } else if (data.listings) {
          processed = (data.listings.processed ?? 0) + (data.profiles?.processed ?? 0);
          hits = (data.listings.embedded ?? 0) + (data.profiles?.embedded ?? 0);
        }
        totalProcessed += processed;
        totalHits += hits;

        const line = `Run ${i + 1}: ${processed} verarbeitet, ${hits} erfolgreich`;
        setRuns((p) => ({
          ...p,
          [job.key]: {
            ...p[job.key],
            state: "running",
            totalProcessed,
            totalHits,
            log: [...p[job.key].log, line],
          },
        }));

        // Stop-Condition: nichts mehr zu tun
        if (processed === 0) break;
      } catch (err) {
        setRuns((p) => ({
          ...p,
          [job.key]: {
            ...p[job.key],
            state: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
        return;
      }
    }

    setRuns((p) => ({
      ...p,
      [job.key]: { ...p[job.key], state: "done" },
    }));
  }

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Admin-Jobs</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Hintergrund-Wartungsjobs. Nur sichtbar mit profile.role = admin.
        </p>
      </div>
      <div className="space-y-3">
        {JOBS.map((job) => {
          const run = runs[job.key];
          const busy = run.state === "running";
          return (
            <div key={job.key} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="size-7 rounded-md bg-[var(--accent)] flex items-center justify-center shrink-0">
                    {job.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{job.label}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {job.description}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => runJob(job)}
                  disabled={busy}
                  className="shrink-0"
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  Starten
                </Button>
              </div>

              {(run.state !== "idle" || run.log.length > 0) && (
                <div className="rounded-md bg-[var(--accent)]/40 p-2 text-[11px] space-y-1 max-h-40 overflow-y-auto">
                  {run.log.map((l, i) => (
                    <div key={i} className="font-mono text-[var(--muted-foreground)]">
                      {l}
                    </div>
                  ))}
                  {run.state === "done" && (
                    <div className="flex items-center gap-1 text-emerald-700 font-medium">
                      <Check className="size-3" /> Fertig — total {run.totalHits} /{" "}
                      {run.totalProcessed}
                    </div>
                  )}
                  {run.state === "error" && (
                    <div className="flex items-center gap-1 text-red-700 font-medium">
                      <AlertCircle className="size-3" /> Fehler: {run.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

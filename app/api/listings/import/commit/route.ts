import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyPreviewToken } from "@/lib/import/preview-token";
import { bulkUpsertListings, ImporterUnavailableError } from "@/lib/repo/listings";
import { embedAndStoreListingsByHash } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  previewToken: z.string().min(20),
  fileName: z.string().max(256).optional(),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "agent" && user.role !== "owner" && user.role !== "admin") {
    return Response.json(
      { error: "forbidden", reason: "broker_role_required" },
      { status: 403 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }

  let payload;
  try {
    payload = await verifyPreviewToken(parsed.data.previewToken);
  } catch (err) {
    return Response.json(
      {
        error: "invalid_token",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 400 }
    );
  }

  if (payload.brokerId !== user.id) {
    return Response.json({ error: "broker_mismatch" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  // Audit-Eintrag anlegen (pending)
  const { data: importRow, error: insertErr } = await supabase
    .from("listing_imports")
    .insert({
      broker_id: user.id,
      file_name: parsed.data.fileName ?? null,
      file_signature: payload.signature,
      total_rows: payload.rows.length,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertErr || !importRow) {
    console.error("[import/commit] audit insert failed", insertErr);
    return Response.json({ error: "audit_failed" }, { status: 500 });
  }

  let result;
  try {
    result = await bulkUpsertListings(user.id, payload.rows);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    await supabase
      .from("listing_imports")
      .update({
        status: "failed",
        failure_detail: detail,
        finished_at: new Date().toISOString(),
      })
      .eq("id", importRow.id);

    if (err instanceof ImporterUnavailableError) {
      return Response.json({ error: "importer_unavailable" }, { status: 503 });
    }
    return Response.json({ error: "import_failed", detail }, { status: 500 });
  }

  await supabase
    .from("listing_imports")
    .update({
      status: "completed",
      inserted_rows: result.inserted,
      updated_rows: result.updated,
      failed_rows: result.failed.length,
      finished_at: new Date().toISOString(),
    })
    .eq("id", importRow.id);

  // Embeddings für alle erfolgreich geschriebenen Zeilen — fire-and-forget,
  // blockiert die Response nicht. Bei Fehler wird per Backfill nachgezogen.
  const successfulHashes = payload.rows
    .filter((_, idx) => !result.failed.some((f) => f.index === idx))
    .map((r) => r.dedup_hash);
  void embedAndStoreListingsByHash(user.id, successfulHashes);

  return Response.json({
    importId: importRow.id,
    inserted: result.inserted,
    updated: result.updated,
    failed: result.failed,
  });
}

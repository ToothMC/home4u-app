import { getAuthUser } from "@/lib/supabase/auth";
import { parseUpload, ParseError } from "@/lib/import/parser";
import { extractListings } from "@/lib/import/extract";
import { signPreviewToken } from "@/lib/import/preview-token";
import type { NormalizedListing } from "@/lib/import/types";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // AI-Extraktion kann bei großen Files dauern

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

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_file" }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = await parseUpload(buffer, file.name);
  } catch (err) {
    if (err instanceof ParseError) {
      return Response.json({ error: err.code, detail: err.message }, { status: 400 });
    }
    console.error("[import/preview] parse failed", err);
    return Response.json({ error: "parse_failed" }, { status: 400 });
  }

  let extraction;
  try {
    extraction = await extractListings(parsed, user.id);
  } catch (err) {
    console.error("[import/preview] extract failed", err);
    return Response.json(
      {
        error: "extract_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 }
    );
  }

  // Dedup-in-File anhand dedup_hash
  const seen = new Set<string>();
  const validRows: NormalizedListing[] = [];
  const items = extraction.items.map((item) => {
    if (item.status !== "valid") return item;
    if (seen.has(item.normalized.dedup_hash)) {
      return {
        status: "duplicate-in-file" as const,
        sourceIndex: item.sourceIndex,
        normalized: item.normalized,
        confidence: item.confidence,
        note: item.note,
      };
    }
    seen.add(item.normalized.dedup_hash);
    validRows.push(item.normalized);
    return item;
  });

  const summary = {
    total: items.length,
    valid: items.filter((i) => i.status === "valid").length,
    errors: items.filter((i) => i.status === "error").length,
    duplicatesInFile: items.filter((i) => i.status === "duplicate-in-file").length,
  };

  const fileSignature = createHash("sha1")
    .update(file.name + ":" + summary.total + ":" + parsed.format)
    .digest("hex");

  let previewToken: string | null = null;
  if (validRows.length > 0) {
    try {
      previewToken = await signPreviewToken({
        brokerId: user.id,
        rows: validRows,
        signature: fileSignature,
      });
    } catch (err) {
      console.error("[import/preview] sign token failed", err);
    }
  }

  return Response.json({
    fileName: file.name,
    inputFormat: parsed.format,
    inputKind: parsed.kind,
    fileSignature,
    summary,
    items: items.slice(0, 200), // UI braucht nicht mehr
    previewToken,
    aiUsage: extraction.usage,
  });
}

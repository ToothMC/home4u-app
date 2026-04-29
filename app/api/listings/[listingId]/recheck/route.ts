import { NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { buildSourceUrl } from "@/lib/listings/source-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECHECK_TIMEOUT_MS = 6000;

type RecheckOutcome =
  | "available"
  | "stale"
  | "unknown"
  | "no_source_url"
  | "skip_direct";

/**
 * JIT-Verfügbarkeits-Check eines Listings.
 *
 * Macht einen kurzen HEAD-Request gegen die Original-URL. 404/410/Redirect
 * auf Listenseite → markiert das Listing als 'stale' via mark_listing_stale.
 * 200 → touch_listing_last_checked, Listing bleibt 'active'.
 *
 * Auth-only. Wird vom Anfrage-Klick aufgerufen, kann aber auch separat von
 * der Card getriggert werden (z.B. Pull-to-Refresh).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId)) {
    return Response.json({ error: "invalid_listing_id" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "supabase_not_configured" }, { status: 500 });
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const { data: listing, error: loadErr } = await supabase
    .from("listings")
    .select("id, source, external_id, extracted_data, status")
    .eq("id", listingId)
    .maybeSingle();

  if (loadErr) {
    console.error("[recheck] listing load failed", loadErr);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
  if (!listing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (listing.status === "stale") {
    return Response.json({ outcome: "stale" satisfies RecheckOutcome, status: "stale" });
  }
  if (listing.source === "direct") {
    return Response.json({ outcome: "skip_direct" satisfies RecheckOutcome, status: listing.status });
  }

  const url = buildSourceUrl(listing);
  if (!url) {
    return Response.json({
      outcome: "no_source_url" satisfies RecheckOutcome,
      status: listing.status,
    });
  }

  const outcome = await probeUrl(url);

  const service = createSupabaseServiceClient();
  if (!service) {
    return Response.json({ outcome, status: listing.status, persisted: false });
  }

  if (outcome === "stale") {
    const { error: rpcErr } = await service.rpc("mark_listing_stale", {
      p_listing_id: listingId,
    });
    if (rpcErr) console.error("[recheck] mark_listing_stale failed", rpcErr);
    return Response.json({ outcome, status: "stale", persisted: !rpcErr });
  }

  if (outcome === "available") {
    const { error: rpcErr } = await service.rpc("touch_listing_last_checked", {
      p_listing_id: listingId,
    });
    if (rpcErr) console.error("[recheck] touch failed", rpcErr);
    return Response.json({ outcome, status: listing.status, persisted: !rpcErr });
  }

  return Response.json({ outcome, status: listing.status, persisted: false });
}

async function probeUrl(url: string): Promise<RecheckOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RECHECK_TIMEOUT_MS);
  try {
    let resp = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Home4U-AvailabilityCheck/1.0)" },
    });
    if (resp.status === 405) {
      // Manche Quellen lehnen HEAD ab — fallback GET, aber nur Header.
      resp = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; Home4U-AvailabilityCheck/1.0)" },
      });
    }
    if (resp.status === 404 || resp.status === 410) return "stale";
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") ?? "";
      if (looksLikeRemovedRedirect(loc)) return "stale";
      return "available";
    }
    if (resp.status >= 200 && resp.status < 300) return "available";
    return "unknown";
  } catch (e) {
    console.warn("[recheck] probe failed", url, e);
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeRemovedRedirect(location: string): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return (
    lower.endsWith("/") ||
    lower.includes("/expired") ||
    lower.includes("/not-found") ||
    lower.includes("/removed")
  );
}

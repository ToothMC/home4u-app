/**
 * Deeplink-Resolver Web-Route: /d/<token>
 *
 * Telegram-Bot baut Sophie-Antworten mit Buttons, die hierhin verlinken.
 * Klick → Token konsumieren (single-use) → Intent-Mapping → 302 zur
 * Ziel-Route.
 *
 * Phase 1: KEIN Auth-Bypass. Wenn die Ziel-Route Auth braucht (z.B. Listing-
 * Edit), zeigt Next.js die normale Login-Seite mit ?next=…-Param. In Phase 2
 * setzen wir hier optional eine Magic-Link-Session, wenn der Token an eine
 * verifizierte channel_identity gebunden ist.
 */
import { NextRequest, NextResponse } from "next/server";
import { consumeDeeplinkToken } from "@/lib/identity/deeplink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) {
    return NextResponse.redirect(new URL("/?d=invalid", req.url));
  }

  const consumed = await consumeDeeplinkToken(token, "to_web");
  if (!consumed) {
    return NextResponse.redirect(new URL("/?d=expired", req.url));
  }

  const target = mapIntentToPath(consumed.intent, consumed.intentPayload);
  if (!target) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(new URL(target, req.url));
}

function mapIntentToPath(
  intent: string,
  payload: Record<string, unknown>
): string | null {
  switch (intent) {
    case "open_match":
      if (typeof payload.match_id === "string") {
        return `/matches/${payload.match_id}`;
      }
      return "/matches";
    case "open_listing":
    case "review_listing":
      if (typeof payload.listing_id === "string") {
        return intent === "review_listing"
          ? `/dashboard/listings/${payload.listing_id}/edit`
          : `/listings/${payload.listing_id}`;
      }
      return null;
    case "view_lead":
      if (typeof payload.match_id === "string") {
        return `/dashboard/requests/${payload.match_id}`;
      }
      return "/dashboard/requests";
    case "login":
      if (typeof payload.next === "string" && payload.next.startsWith("/")) {
        return payload.next;
      }
      return "/dashboard";
    default:
      return null;
  }
}

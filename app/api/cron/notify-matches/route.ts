import { NextRequest } from "next/server";
import { runMatchNotifier } from "@/lib/notifications/match-notifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-Endpoint für tägliche Match-Benachrichtigungen.
 *
 * Vercel Cron ruft diesen Endpoint per GET auf. Authentifizierung über
 * den Vercel-eigenen Header `x-vercel-cron-signature` ODER über
 * CRON_SECRET als Bearer Token (für manuelle Trigger / lokale Tests).
 *
 * Frequenz wird in vercel.json gesteuert. Empfehlung: 1× pro Tag,
 * morgens (09:00 UTC).
 */
export async function GET(req: NextRequest) {
  const authed = isAuthorized(req);
  if (!authed) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMatchNotifier();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/notify-matches] failed", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

function isAuthorized(req: NextRequest): boolean {
  // Vercel Cron schickt diesen Header automatisch — gut genug auf Vercel.
  if (req.headers.get("x-vercel-cron-signature")) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  // Fallback für direkten Browser-Test mit Query-Param
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

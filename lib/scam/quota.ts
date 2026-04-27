/**
 * Free-Tier-Quota für Scam-Shield (Spec B §7).
 *
 * Limit: 3 Scam-Checks pro Nutzer in einem rollenden 30-Tage-Fenster.
 * Premium: unlimited (siehe TIER_LIMITS — aktuell hardcoded; Subscriptions-
 * Tabelle kommt mit späterer Iteration).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const TIER_LIMITS = {
  free: 3,
  premium: Number.POSITIVE_INFINITY,
  vip: Number.POSITIVE_INFINITY,
} as const;

export const QUOTA_WINDOW_DAYS = 30;

export type QuotaIdentity =
  | { userId: string; anonymousId?: string | null }
  | { userId?: null; anonymousId: string };

export type QuotaResult = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Wann das älteste zählende Check expirt — relevant fürs UI „nächster Check ab …". */
  resetAt: string | null;
  tier: "free" | "premium" | "vip";
};

/**
 * Aktuell ist Tier-Resolution simpel: alle eingeloggten User sind 'free',
 * bis Premium-Subscriptions implementiert sind. Anonyme User sind immer 'free'.
 *
 * TODO (Phase B Folge): Subscriptions-Tabelle prüfen.
 */
export async function resolveTier(identity: QuotaIdentity): Promise<"free" | "premium" | "vip"> {
  // identity wird genutzt, sobald Subscriptions-Tabelle existiert.
  void identity;
  return "free";
}

/**
 * Zählt Scam-Checks im Quota-Fenster + entscheidet allowed/blocked.
 * Liefert auch im Premium-Fall einen Used-Counter für UI-Anzeige.
 */
export async function checkScamQuota(identity: QuotaIdentity): Promise<QuotaResult> {
  const tier = await resolveTier(identity);
  const limit = TIER_LIMITS[tier];

  const sb = createSupabaseServiceClient();
  if (!sb) {
    // Service-Client nicht konfiguriert — fail open mit limit, damit Dev-Lokal
    // ohne Supabase nicht alles blockiert.
    return { allowed: true, used: 0, limit, remaining: limit, resetAt: null, tier };
  }

  // Count + älteste zählende Submission für resetAt
  const sinceIso = new Date(Date.now() - QUOTA_WINDOW_DAYS * 86_400_000).toISOString();
  let q = sb
    .from("scam_checks")
    .select("submitted_at", { count: "exact" })
    .gte("submitted_at", sinceIso);

  if (identity.userId) q = q.eq("user_id", identity.userId);
  else q = q.eq("anonymous_id", identity.anonymousId);

  const { data, count, error } = await q.order("submitted_at", { ascending: true }).limit(1);
  if (error) {
    console.warn("[scam/quota] count failed", error.message);
    // Fail-open bei DB-Fehler — UX > Strict-Enforcement
    return { allowed: true, used: 0, limit, remaining: limit, resetAt: null, tier };
  }

  const used = count ?? 0;
  const oldest = data?.[0]?.submitted_at ?? null;
  const resetAt = oldest
    ? new Date(new Date(oldest).getTime() + QUOTA_WINDOW_DAYS * 86_400_000).toISOString()
    : null;

  const allowed = Number.isFinite(limit) ? used < limit : true;
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : Number.POSITIVE_INFINITY;

  return { allowed, used, limit, remaining, resetAt, tier };
}

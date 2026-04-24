import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthUser = {
  id: string;
  email: string | null;
};

/**
 * Liefert den aktuell eingeloggten User (oder null) basierend auf
 * dem sb-access-token-Cookie, das @supabase/ssr setzt.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

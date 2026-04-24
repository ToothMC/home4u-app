import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserRole = "seeker" | "owner" | "agent" | "admin" | null;

export type AuthUser = {
  id: string;
  email: string | null;
  role: UserRole;
};

/**
 * Liefert den eingeloggten User (oder null) samt gewählter Rolle aus
 * profiles.role. Rolle = null bedeutet: Nutzer hat noch keine Rolle
 * bewusst gewählt (neue User ohne Default).
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: user.email ?? null,
      role: (profile?.role as UserRole) ?? null,
    };
  } catch {
    return null;
  }
}

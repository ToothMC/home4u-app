"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, User as UserIcon, Loader2, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "user"; email: string | null };

export function AuthMenu({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        if (data.user) {
          setState({ status: "user", email: data.user.email ?? null });
        } else {
          setState({ status: "anon" });
        }
        supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setState({
              status: "user",
              email: session.user.email ?? null,
            });
          } else {
            setState({ status: "anon" });
          }
        });
      } catch {
        if (!cancelled) setState({ status: "anon" });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  if (state.status === "loading") {
    return (
      <div
        className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] px-3 py-1.5"
        aria-live="polite"
      >
        <Loader2 className="size-3 animate-spin" />
      </div>
    );
  }

  if (state.status === "user") {
    const label = state.email ?? "Account";
    return (
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard" aria-label="Dashboard">
            <LayoutDashboard className="size-3" />
            {compact ? null : <span>Dashboard</span>}
          </Link>
        </Button>
        <span
          className={
            "flex items-center gap-1 text-xs text-[var(--muted-foreground)] max-w-[160px] truncate" +
            (compact ? "" : " sm:max-w-none")
          }
          title={label}
        >
          <UserIcon className="size-3" />
          {compact ? label.split("@")[0] : label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={signOut}
          aria-label="Abmelden"
        >
          <LogOut className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LogIn className="size-3" />
        Anmelden
      </Button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

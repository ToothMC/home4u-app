"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, User as UserIcon, Loader2, LayoutDashboard, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { MobileNav } from "@/components/nav/MobileNav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "user"; email: string | null };

export function AuthMenu({
  compact = false,
  hideDashboard = false,
}: {
  compact?: boolean;
  /** Auf Seiten, die bereits einen Dashboard-Backlink haben (z.B. /matches),
   *  ist der zusätzliche Button im AuthMenu redundant — dann ausblenden. */
  hideDashboard?: boolean;
}) {
  const { t } = useT();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);

  // window.location statt useSearchParams() — Suspense-Boundary-Build-Trap.
  // Wir öffnen den Dialog sofort beim Mount falls ?auth=required in der URL
  // steht, unabhängig vom auth-Loading-State. Wenn der User schon eingeloggt
  // ist, schließt sich der Dialog beim onAuthStateChange-Event eh wieder
  // (oder existiert gar nicht weil der "user"-Branch oben rendert).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "required") setOpen(true);
    setNextUrl(params.get("next"));
  }, []);

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
      <>
        <MobileNav />
        <div
          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] px-3 py-1.5"
          aria-live="polite"
        >
          <Loader2 className="size-3 animate-spin" />
        </div>
      </>
    );
  }

  // Feedback-Button (Icon-only) — auf Desktop sichtbar im Header,
  // auf Mobile via MobileNav-Footer-Eintrag erreichbar.
  const feedbackButton = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setFeedbackOpen(true)}
      aria-label={t("feedback.button.label")}
      title={t("feedback.button.label")}
      className="hidden sm:inline-flex"
    >
      <MessageSquare className="size-3" />
    </Button>
  );

  const openFeedback = () => setFeedbackOpen(true);

  if (state.status === "user") {
    // Nur Local-Part anzeigen (vor dem @): michael@mmhammer.org → michael
    const label = state.email ? state.email.split("@")[0] : t("auth.menu.account");
    return (
      <div className="flex items-center gap-2">
        <MobileNav onFeedbackClick={openFeedback} />
        {feedbackButton}
        {!hideDashboard && (
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard" aria-label={t("common.dashboard")}>
              <LayoutDashboard className="size-3" />
              {!compact && (
                <span className="hidden sm:inline">{t("common.dashboard")}</span>
              )}
            </Link>
          </Button>
        )}
        <Link
          href="/dashboard/profile"
          className={
            "flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] max-w-[160px] truncate" +
            (compact ? "" : " sm:max-w-none")
          }
          title={state.email ?? t("auth.menu.profile")}
        >
          <UserIcon className="size-3" />
          {label}
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={signOut}
          aria-label={t("auth.menu.signout")}
        >
          <LogOut className="size-3" />
        </Button>
        <FeedbackDialog
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          defaultEmail={state.email}
        />
      </div>
    );
  }

  return (
    <>
      <MobileNav onFeedbackClick={openFeedback} />
      {feedbackButton}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LogIn className="size-3" />
        <span className="hidden sm:inline">{t("auth.menu.signin")}</span>
      </Button>
      <SignInDialog
        open={open}
        onOpenChange={setOpen}
        redirectAfter={nextUrl ?? undefined}
      />
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        defaultEmail={null}
      />
    </>
  );
}

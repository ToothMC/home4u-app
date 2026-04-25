import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { AdminJobsPanel } from "@/components/dashboard/AdminJobsPanel";
import { getAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAuthUser();
  if (!user) redirect("/?auth=required");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <AuthMenu />
      </header>
      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10 space-y-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <AdminJobsPanel />
      </section>
    </main>
  );
}

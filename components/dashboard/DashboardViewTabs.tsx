"use client";

import Link from "next/link";
import { SearchIcon, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardViewTabs({
  current,
}: {
  current: "seeker" | "provider";
}) {
  return (
    <div className="inline-flex rounded-md border p-1 mb-4">
      <Tab href="/dashboard?view=seeker" active={current === "seeker"}>
        <SearchIcon className="size-3" />
        Ich suche
      </Tab>
      <Tab href="/dashboard?view=provider" active={current === "provider"}>
        <KeyRound className="size-3" />
        Ich biete
      </Tab>
    </div>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "hover:bg-[var(--accent)]"
      )}
    >
      {children}
    </Link>
  );
}

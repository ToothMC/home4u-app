"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageCircle, KeyRound, Building2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appendRegionParam } from "@/components/landing/RegionPicker";
import { useT } from "@/lib/i18n/client";

export function PathCards() {
  const searchParams = useSearchParams();
  const region = searchParams.get("region");
  const { t } = useT();

  const href = (flow: string) =>
    appendRegionParam(`/chat?flow=${flow}`, region);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <PathCard
        icon={<MessageCircle className="size-6" />}
        title={t("paths.seeker.title")}
        description={t("paths.seeker.text")}
        cta={t("paths.seeker.cta")}
        href={href("seeker")}
      />
      <PathCard
        icon={<Megaphone className="size-6" />}
        title={t("paths.found.title")}
        description={t("paths.found.text")}
        cta={t("paths.found.cta")}
        href="/gesuche"
      />
      <PathCard
        icon={<KeyRound className="size-6" />}
        title={t("paths.owner.title")}
        description={t("paths.owner.text")}
        cta={t("paths.owner.cta")}
        href={href("owner")}
      />
      <PathCard
        icon={<Building2 className="size-6" />}
        title={t("paths.agent.title")}
        description={t("paths.agent.text")}
        cta={t("paths.agent.cta")}
        href={href("agent")}
      />
    </div>
  );
}

function PathCard({
  icon,
  title,
  description,
  cta,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  href: string;
}) {
  return (
    <Card className="group relative overflow-hidden h-full flex flex-col border-[var(--border)] hover:border-[var(--brand-gold-300)] hover:shadow-[0_14px_40px_-10px_rgb(120_90_50/15%)] transition-all">
      <CardHeader>
        <div className="size-12 rounded-xl bg-[var(--brand-gold-50)] text-[var(--brand-gold-700)] flex items-center justify-center mb-3 group-hover:bg-[var(--brand-gold-100)] transition-colors">
          {icon}
        </div>
        <CardTitle className="text-[var(--brand-navy)]">{title}</CardTitle>
        <CardDescription className="text-[var(--warm-bark)] leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Button asChild className="w-full" variant="outline">
          <Link href={href}>{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ChatLink({
  flow,
  children,
  className,
  onClick,
}: {
  flow?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const searchParams = useSearchParams();
  const region = searchParams.get("region");
  const base = flow ? `/chat?flow=${flow}` : "/chat";
  return (
    <Link href={appendRegionParam(base, region)} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

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

export function PathCards() {
  const searchParams = useSearchParams();
  const region = searchParams.get("region");

  const href = (flow: string) =>
    appendRegionParam(`/chat?flow=${flow}`, region);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <PathCard
        icon={<MessageCircle className="size-6" />}
        title="Ich suche"
        description="Erzähl Sophie in fünf Minuten, was du brauchst. Sie meldet sich, sobald sie passende Wohnungen findet."
        cta="Suche starten"
        href={href("seeker")}
      />
      <PathCard
        icon={<Megaphone className="size-6" />}
        title="Gefunden werden"
        description="Gib dein Such-Profil frei, damit Makler dich finden und dir passende Objekte anbieten können."
        cta="Such-Inserate ansehen"
        href="/gesuche"
      />
      <PathCard
        icon={<KeyRound className="size-6" />}
        title="Ich biete (privat)"
        description="Dein Inserat in 3 Minuten. KI-Preisempfehlung, mehrsprachige Texte, Vorschau-Modus uvm."
        cta="Inserat erstellen"
        href={href("owner")}
      />
      <PathCard
        icon={<Building2 className="size-6" />}
        title="Ich bin Makler"
        description="Beta-Zugang für die ersten 50 Partner — Bulk-Import, Such-Inserate, 4-sprachig uvm."
        cta="Makler-Beirat"
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
    <Card className="group relative overflow-hidden border-[var(--border)] hover:border-[var(--brand-gold-300)] hover:shadow-[0_14px_40px_-10px_rgb(120_90_50/15%)] transition-all">
      <CardHeader>
        <div className="size-12 rounded-xl bg-[var(--brand-gold-50)] text-[var(--brand-gold-700)] flex items-center justify-center mb-3 group-hover:bg-[var(--brand-gold-100)] transition-colors">
          {icon}
        </div>
        <CardTitle className="text-[var(--brand-navy)]">{title}</CardTitle>
        <CardDescription className="text-[var(--warm-bark)] leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
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

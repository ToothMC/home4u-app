"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageCircle, KeyRound, Building2 } from "lucide-react";
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
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <MessageCircle className="size-6 mb-2" />
          <CardTitle>Ich suche</CardTitle>
          <CardDescription>
            Erzähl Sophie in fünf Minuten, was du brauchst. Sie meldet sich,
            sobald sie passende Wohnungen findet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full" variant="outline">
            <Link href={href("seeker")}>Suche starten</Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <KeyRound className="size-6 mb-2" />
          <CardTitle>Ich vermiete privat</CardTitle>
          <CardDescription>
            Wohnung online in unter 10 Minuten. KI-Preisempfehlung,
            mehrsprachige Texte, qualifizierte Interessenten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full" variant="outline">
            <Link href={href("owner")}>Inserat erstellen</Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Building2 className="size-6 mb-2" />
          <CardTitle>Ich bin Makler</CardTitle>
          <CardDescription>
            Beta-Zugang für die ersten 50 Partner — Bulk-Import, Lead-Scoring,
            mehrsprachige Inserate, kein Bait-and-Switch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full" variant="outline">
            <Link href={href("agent")}>Makler-Beirat</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function ChatLink({
  flow,
  children,
  className,
}: {
  flow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const region = searchParams.get("region");
  const base = flow ? `/chat?flow=${flow}` : "/chat";
  return (
    <Link href={appendRegionParam(base, region)} className={className}>
      {children}
    </Link>
  );
}

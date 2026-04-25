import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, Upload } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { ImportDropzone } from "@/components/dashboard/ImportDropzone";
import { getAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getAuthUser();
  if (!user) redirect("/?auth=required");
  if (user.role !== "agent" && user.role !== "owner" && user.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-4 pt-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-[var(--muted-foreground)]">
          ← Dashboard
        </Link>
        <AuthMenu />
      </div>

      <section className="mx-auto max-w-4xl px-4 pt-6 pb-10">
        <div className="flex items-center gap-2 mb-2">
          <Upload className="size-6" />
          <h1 className="text-2xl sm:text-3xl font-semibold">Inserate hochladen</h1>
        </div>
        <p className="text-sm text-[var(--muted-foreground)] mb-2 max-w-2xl">
          Lad einfach hoch, was du hast — eine Excel-Datei aus deinem CRM, ein
          PDF-Export aus Bazaraki, eine CSV oder eine Notiz aus Word. Sophie liest
          die Daten und schlägt dir vor, was importiert wird. Du bestätigst.
        </p>
        <p className="text-xs text-[var(--muted-foreground)] mb-6 flex items-center gap-1">
          <Sparkles className="size-3" />
          Akzeptiert: CSV, Excel, PDF, TXT — bis 10 MB.
        </p>

        <ImportDropzone />

        <div className="mt-8 rounded-lg border p-4 bg-[var(--accent)] text-sm">
          <strong>Was passiert mit den Daten?</strong>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-[var(--muted-foreground)]">
            <li>
              Die KI extrahiert Stadt, Preis, Zimmer, Größe, Kontakt und Bilder.
              Erfundene Werte gibt es nicht — was unklar ist, wird als Fehler markiert.
            </li>
            <li>
              Doppelte Inserate (gleiche Referenz oder Stadt+Preis+Zimmer) werden
              automatisch zusammengeführt — Re-Imports aktualisieren statt zu duplizieren.
            </li>
            <li>
              Telefonnummern werden verschlüsselt gespeichert. Bilder werden als
              URLs übernommen, nicht hochgeladen.
            </li>
          </ul>
        </div>

        <div className="mt-4 text-xs text-[var(--muted-foreground)]">
          Lieber eine Vorlage?{" "}
          <a
            href="/api/listings/import/template"
            className="underline hover:no-underline"
          >
            CSV-Beispiel herunterladen
          </a>
          .
        </div>
      </section>
    </main>
  );
}

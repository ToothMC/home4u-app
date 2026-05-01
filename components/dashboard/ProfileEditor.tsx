"use client";

import * as React from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ProfileForm = {
  display_name: string | null;
  phone: string | null;
  preferred_language: "de" | "en" | "ru" | "el" | "zh" | null;
  contact_channel: "email" | "whatsapp" | "telegram" | "phone" | "chat" | null;
  notification_email: string | null;
};

const LANGS: { value: ProfileForm["preferred_language"]; label: string }[] = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "el", label: "Ελληνικά" },
  { value: "zh", label: "中文" },
];

const CHANNELS: { value: ProfileForm["contact_channel"]; label: string }[] = [
  { value: "chat", label: "Home4U-Chat (Default)" },
  { value: "email", label: "E-Mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "phone", label: "Telefon" },
];

export function ProfileEditor({
  initial,
  authEmail,
}: {
  initial: ProfileForm;
  authEmail: string | null;
}) {
  const [form, setForm] = React.useState<ProfileForm>(initial);
  const [busy, setBusy] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function update<K extends keyof ProfileForm>(
    key: K,
    value: ProfileForm[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? "Konnte nicht speichern");
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <div className="rounded-lg bg-[var(--accent)]/40 border border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] leading-relaxed">
        Du kannst auf Home4U gleichzeitig <strong>suchen</strong>,{" "}
        <strong>vermieten / verkaufen</strong> und als{" "}
        <strong>Makler</strong> arbeiten — kein Lock-in. Im Dashboard kannst
        du oben zwischen den Ansichten wechseln.
      </div>

      <Field label="Anzeigename">
        <Input
          value={form.display_name ?? ""}
          onChange={(e) => update("display_name", e.target.value || null)}
          placeholder="Wie sollen Anbieter dich nennen?"
          maxLength={120}
        />
      </Field>

      <Field label="Telefon" hint="Internationales Format empfohlen, z.B. +357 99 123456">
        <Input
          value={form.phone ?? ""}
          onChange={(e) => update("phone", e.target.value || null)}
          placeholder="+357 …"
          inputMode="tel"
          maxLength={40}
        />
      </Field>

      <Field label="Bevorzugter Kontakt-Kanal" hint="Wie sollen wir dich erreichen, wenn ein Match zustande kommt?">
        <select
          value={form.contact_channel ?? ""}
          onChange={(e) =>
            update(
              "contact_channel",
              (e.target.value || null) as ProfileForm["contact_channel"]
            )
          }
          className="flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
        >
          <option value="">— wählen —</option>
          {CHANNELS.map((c) => (
            <option key={c.value ?? ""} value={c.value ?? ""}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Sprache">
        <select
          value={form.preferred_language ?? ""}
          onChange={(e) =>
            update(
              "preferred_language",
              (e.target.value || null) as ProfileForm["preferred_language"]
            )
          }
          className="flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
        >
          <option value="">— wählen —</option>
          {LANGS.map((l) => (
            <option key={l.value ?? ""} value={l.value ?? ""}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Notifications-E-Mail (optional)"
        hint={
          authEmail
            ? `Wenn leer, gehen Match-Mails an deine Login-Adresse: ${authEmail}`
            : "Wenn leer, gehen Mails an deine Login-Adresse."
        }
      >
        <Input
          type="email"
          value={form.notification_email ?? ""}
          onChange={(e) => update("notification_email", e.target.value || null)}
          placeholder="andere@adresse.com"
          maxLength={200}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Speichern
        </Button>
        {savedAt && (
          <span className="text-sm text-emerald-700">Gespeichert</span>
        )}
        {error && <span className="text-sm text-rose-700">{error}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--foreground)] mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-[var(--muted-foreground)] mt-1">
          {hint}
        </span>
      )}
    </label>
  );
}

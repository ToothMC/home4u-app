"use client";

import * as React from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { tFormat, type TKey } from "@/lib/i18n/dict";

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

const CHANNELS: { value: NonNullable<ProfileForm["contact_channel"]>; key: TKey }[] = [
  { value: "chat", key: "profileEditor.channel.chat" },
  { value: "email", key: "profileEditor.channel.email" },
  { value: "whatsapp", key: "profileEditor.channel.whatsapp" },
  { value: "telegram", key: "profileEditor.channel.telegram" },
  { value: "phone", key: "profileEditor.channel.phone" },
];

export function ProfileEditor({
  initial,
  authEmail,
}: {
  initial: ProfileForm;
  authEmail: string | null;
}) {
  const { t } = useT();
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
        setError(detail.detail ?? detail.error ?? t("profileEditor.saveError"));
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError(t("btn.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const introHtml = React.useMemo(() => {
    return t("profileEditor.intro").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }, [t]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-5"
    >
      <div
        className="rounded-lg bg-[var(--accent)]/40 border border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: introHtml }}
      />

      <Field label={t("profileEditor.displayName")}>
        <Input
          value={form.display_name ?? ""}
          onChange={(e) => update("display_name", e.target.value || null)}
          placeholder={t("profileEditor.displayNamePlaceholder")}
          maxLength={120}
        />
      </Field>

      <Field label={t("profileEditor.phone")} hint={t("profileEditor.phoneHint")}>
        <Input
          value={form.phone ?? ""}
          onChange={(e) => update("phone", e.target.value || null)}
          placeholder="+357 …"
          inputMode="tel"
          maxLength={40}
        />
      </Field>

      <Field
        label={t("profileEditor.contactChannel")}
        hint={t("profileEditor.contactChannelHint")}
      >
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
          <option value="">{t("profileEditor.choose")}</option>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.key)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("profileEditor.language")}>
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
          <option value="">{t("profileEditor.choose")}</option>
          {LANGS.map((l) => (
            <option key={l.value ?? ""} value={l.value ?? ""}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t("profileEditor.notifEmail")}
        hint={
          authEmail
            ? tFormat(t("profileEditor.notifEmailHint"), { email: authEmail })
            : t("profileEditor.notifEmailHintFallback")
        }
      >
        <Input
          type="email"
          value={form.notification_email ?? ""}
          onChange={(e) => update("notification_email", e.target.value || null)}
          placeholder={t("profileEditor.notifEmailPlaceholder")}
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
          {t("profileEditor.save")}
        </Button>
        {savedAt && (
          <span className="text-sm text-emerald-700">{t("profileEditor.saved")}</span>
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

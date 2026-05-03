"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";

const MIN_LEN = 10;
const MAX_LEN = 4000;

type Status = "idle" | "sending" | "success" | "error";

export function FeedbackDialog({
  open,
  onOpenChange,
  defaultEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail?: string | null;
}) {
  const { t } = useT();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail ?? "");
      setStatus("idle");
      setError(null);
    } else {
      // Reset content nur wenn dialog geschlossen ist
      const id = setTimeout(() => {
        setMessage("");
        setWebsite("");
      }, 200);
      return () => clearTimeout(id);
    }
  }, [open, defaultEmail]);

  useEffect(() => {
    if (open && status === "idle") messageRef.current?.focus();
  }, [open, status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < MIN_LEN) {
      setError(t("feedback.error.tooShort"));
      return;
    }
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          email: email.trim() || undefined,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "send_failed");
      }
      setStatus("success");
      setTimeout(() => {
        onOpenChange(false);
      }, 1800);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error && err.message === "rate_limited"
          ? t("feedback.error.generic")
          : t("feedback.error.generic")
      );
    }
  }

  const tooShort = message.trim().length > 0 && message.trim().length < MIN_LEN;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl bg-[var(--background)] p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <Dialog.Close
            aria-label={t("common.back")}
            className="absolute right-3 top-3 p-1 hover:bg-[var(--accent)] rounded-md"
          >
            <X className="size-4" />
          </Dialog.Close>

          {status === "success" ? (
            <div className="py-8 text-center">
              <Dialog.Title className="text-lg font-semibold">
                {t("feedback.success")} ✓
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {t("feedback.success")}
              </Dialog.Description>
            </div>
          ) : (
            <>
              <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="size-4" /> {t("feedback.dialog.title")}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-[var(--muted-foreground)] mt-1 mb-4">
                {t("feedback.dialog.intro")}
              </Dialog.Description>

              <form onSubmit={submit} className="space-y-3">
                {/* Honeypot — visually hidden but reachable to bots */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "-10000px",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                  }}
                >
                  <label>
                    Website
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>

                <div>
                  <label className="text-xs text-[var(--muted-foreground)] block mb-1">
                    {t("feedback.field.email")}
                  </label>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t("feedback.field.email.placeholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={status === "sending"}
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--muted-foreground)] block mb-1">
                    {t("feedback.field.message")}
                  </label>
                  <Textarea
                    ref={messageRef}
                    placeholder={t("feedback.field.message.placeholder")}
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                    disabled={status === "sending"}
                    required
                    rows={6}
                    className="resize-y"
                  />
                  <div className="mt-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                    <span className={tooShort ? "text-[var(--destructive)]" : ""}>
                      {tooShort ? t("feedback.error.tooShort") : " "}
                    </span>
                    <span>
                      {message.trim().length}/{MAX_LEN}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={status === "sending" || message.trim().length < MIN_LEN}
                >
                  {status === "sending" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {status === "sending" ? t("feedback.submitting") : t("feedback.submit")}
                </Button>

                {error && (
                  <p className="text-sm text-[var(--destructive)]">{error}</p>
                )}
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

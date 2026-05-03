"use client";

import * as React from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Message = {
  id: string;
  sender_user_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  mine: boolean;
  original_language: string | null;
  display_text: string;
  is_translated: boolean;
};

const LANG_LABEL: Record<string, string> = {
  de: "DE",
  en: "EN",
  ru: "RU",
  el: "EL",
};

/**
 * Direkt-Chat zwischen den beiden Match-Teilnehmern. Lädt initial via
 * GET, postet via POST, pollt alle 5s nach neuen Nachrichten. Kein
 * Realtime — kommt später, falls nötig.
 */
export function MatchChatThread({
  matchId,
  counterpartyLabel,
}: {
  matchId: string;
  /** Anzeigename der Gegenseite — nur fürs UI-Header. */
  counterpartyLabel: string;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.error ?? "Konnte Chat nicht laden");
        return;
      }
      const json = await res.json();
      setMessages((json.messages as Message[]) ?? []);
      setError(null);
    } catch {
      setError("Netzwerkfehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  // Initial + Polling alle 5s
  React.useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-Scroll zum Ende, wenn neue Nachrichten kommen
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // Optimistic — UI zeigt sofort, korrigiert wenn der Server failt
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      sender_user_id: "me",
      content: text,
      created_at: new Date().toISOString(),
      read_at: null,
      mine: true,
      original_language: null,
      display_text: text,
      is_translated: false,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.error ?? "Senden fehlgeschlagen");
        // Optimistic rückgängig
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setInput(text);
        return;
      }
      // Server-Antwort hat echte ID — Liste neu laden für Konsistenz
      await load();
    } catch {
      setError("Netzwerkfehler beim Senden");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-[var(--card)] overflow-hidden flex flex-col h-[480px]">
      <div className="px-4 py-3 border-b text-sm font-medium flex items-center justify-between">
        <span>Direkt-Chat mit {counterpartyLabel}</span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {messages.length > 0
            ? `${messages.length} ${messages.length === 1 ? "Nachricht" : "Nachrichten"}`
            : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[var(--background)]">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="size-3 animate-spin" /> Lädt…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] text-center pt-6">
            Noch keine Nachrichten — schreib den ersten Gruß.
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t p-2 bg-[var(--card)]"
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Nachricht schreiben…"
            rows={1}
            className="resize-none min-h-[40px] max-h-32"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={sending}
          />
          <Button
            type="submit"
            disabled={sending || !input.trim()}
            size="icon"
            aria-label="Senden"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
        {error && (
          <p className="mt-1 text-xs text-rose-700 px-1">{error}</p>
        )}
      </form>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const time = new Date(message.created_at).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const body = showOriginal ? message.content : message.display_text;
  const sourceLabel = message.original_language
    ? LANG_LABEL[message.original_language] ?? message.original_language.toUpperCase()
    : null;
  return (
    <div
      className={
        "flex " + (message.mine ? "justify-end" : "justify-start")
      }
    >
      <div
        className={
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug " +
          (message.mine
            ? "bg-emerald-600 text-white rounded-br-sm"
            : "bg-[var(--accent)] text-[var(--foreground)] rounded-bl-sm")
        }
      >
        <p className="whitespace-pre-wrap break-words">{body}</p>
        {message.is_translated && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className={
              "mt-1 text-[10px] underline-offset-2 hover:underline " +
              (message.mine ? "text-white/80" : "text-[var(--muted-foreground)]")
            }
          >
            {showOriginal
              ? "Übersetzung anzeigen"
              : sourceLabel
                ? `Übersetzt aus ${sourceLabel} · Original anzeigen`
                : "Original anzeigen"}
          </button>
        )}
        <p
          className={
            "text-[10px] mt-1 " +
            (message.mine ? "text-white/70" : "text-[var(--muted-foreground)]")
          }
        >
          {time}
        </p>
      </div>
    </div>
  );
}

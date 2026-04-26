"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  ArrowLeft,
  Wrench,
  Check,
  X,
  MapPin,
  Search,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { MediaUploader, type AttachedMedia } from "@/components/chat/MediaUploader";
import type { Region } from "@/lib/regions";

type ToolCall = {
  id: string;
  name: string;
  input: string;
  result?: { ok: boolean; error?: string };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
};

const SEED_MESSAGE: Record<string, string> = {
  seeker:
    "Hi, ich bin Sophie — Dein KI-Agent von Home4U. In welcher Stadt oder Region darf ich dich beim Suchen unterstützen?",
  owner:
    "Hi, ich bin Sophie — Dein KI-Agent von Home4U. Lass uns dein Inserat anlegen. In welcher Stadt und welchem Viertel liegt die Immobilie?",
  agent:
    "Hi, ich bin Sophie — Dein KI-Agent von Home4U. Schön, dass du dich für den Makler-Beirat interessierst. In welcher Stadt oder Region arbeitest du aktuell?",
  default:
    "Hi, ich bin Sophie — Dein KI-Agent von Home4U. In welcher Stadt oder Region darf ich dich unterstützen?",
};

export function ChatView({
  flow,
  region,
}: {
  flow?: string;
  region?: Region;
}) {
  const baseSeed = SEED_MESSAGE[flow ?? "default"] ?? SEED_MESSAGE.default;
  // Für seeker/default bekommt der Region-Seed Vorrang (macht Sophie konkreter).
  // Für owner/agent bleibt der Flow-Seed erhalten, Region wird nur im Header angezeigt.
  const useRegionSeed = region && (flow === "seeker" || !flow || flow === "default");
  const seed = useRegionSeed
    ? `Hi, ich bin Sophie — Dein KI-Agent von Home4U. Ich arbeite gerade für dich in ${region!.label}. Was kann ich tun?`
    : baseSeed;
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: seed },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [attached, setAttached] = useState<AttachedMedia[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Letzte Conversation des Users/der Session beim Mount laden.
  // ABER: wenn flow explizit gesetzt ist (z.B. via "+ Inserat" / "+ Suche"-
  // Button), starten wir bewusst frisch mit dem flow-spezifischen Seed —
  // sonst landet man in der alten Konversation und Sophie reagiert nicht
  // auf die Intent.
  useEffect(() => {
    if (flow) return; // explizite Flow-Wahl ignoriert History
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/history", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.conversation) return;
        const hist = data.conversation as {
          conversationId: string;
          messages: ChatMessage[];
        };
        if (hist.messages?.length) {
          setMessages(hist.messages);
          setConversationId(hist.conversationId);
        }
      } catch {
        // silently ignore — fallback bleibt der Seed
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");

    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextHistory);
    setStreaming(true);

    // Für die API: nur Text-Nachrichten, Seed überspringen wir nicht —
    // er hilft Sophie als initialer Kontext.
    const payloadMessages = nextHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          conversationId,
          flow,
          region: region
            ? { slug: region.slug, label: region.label }
            : undefined,
          attached_media: attached.map((m) => ({
            url: m.url,
            kind: m.kind,
            name: m.name,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }

      let assistantText = "";
      const toolCalls: ToolCall[] = [];
      let currentTool: ToolCall | null = null;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", toolCalls: [] },
      ]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === "conversation" && typeof evt.id === "string") {
            setConversationId(evt.id);
          } else if (evt.type === "text" && typeof evt.delta === "string") {
            assistantText += evt.delta;
          } else if (
            evt.type === "tool_use_start" &&
            typeof evt.name === "string" &&
            typeof evt.id === "string"
          ) {
            currentTool = { id: evt.id, name: evt.name, input: "" };
            toolCalls.push(currentTool);
          } else if (
            evt.type === "tool_input_delta" &&
            typeof evt.delta === "string" &&
            currentTool
          ) {
            currentTool.input += evt.delta;
          } else if (evt.type === "tool_result" && typeof evt.id === "string") {
            const tc = toolCalls.find((t) => t.id === evt.id);
            if (tc) {
              tc.result = {
                ok: Boolean(evt.ok),
                error: typeof evt.error === "string" ? evt.error : undefined,
              };
            }
          } else if (evt.type === "error") {
            throw new Error(String(evt.message ?? "stream_error"));
          }

          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                role: "assistant",
                content: assistantText,
                toolCalls: toolCalls.map((t) => ({ ...t })),
              };
            }
            return copy;
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col flex-1 h-[100dvh] max-h-[100dvh]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--warm-cream)]/85 backdrop-blur px-4 py-3">
        <Button asChild size="icon" variant="ghost" aria-label="Zurück">
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sophie/apple-touch-icon.png"
          alt="Sophie"
          width={36}
          height={36}
          className="size-9 rounded-full object-cover ring-2 ring-[var(--brand-gold)]/40 shadow-[0_4px_12px_-4px_rgb(26_46_68/30%)]"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight text-[var(--brand-navy)]">Sophie</p>
          <p className="text-xs text-[var(--warm-bark)] leading-tight">
            Home<span className="text-[var(--brand-gold)] font-semibold">4</span>U · KI-Assistentin
          </p>
        </div>
        {region && (
          <Link
            href="/#region"
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] rounded-full border px-3 py-1.5 hover:bg-[var(--accent)]"
            aria-label="Region wechseln"
          >
            <MapPin className="size-3" />
            {region.city}
          </Link>
        )}
        <AuthMenu compact />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-4 space-y-4">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {streaming && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] px-2">
              <Loader2 className="size-3 animate-spin" />
              Sophie tippt…
            </div>
          )}
          {error && (
            <div className="text-sm text-[var(--destructive)] border border-[var(--destructive)] rounded-md px-3 py-2">
              Fehler: {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t px-3 py-3 bg-[var(--background)]"
      >
        <div className="mx-auto max-w-2xl flex flex-col gap-2">
          <MediaUploader
            attached={attached}
            onAttached={(m) =>
              setAttached((prev) =>
                prev.some((p) => p.url === m.url) ? prev : [...prev, m]
              )
            }
            onRemove={(url) =>
              setAttached((prev) => prev.filter((m) => m.url !== url))
            }
            disabled={streaming}
          />
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Schreib Sophie…"
              className="resize-none min-h-[44px] max-h-40"
              disabled={streaming}
            />
            <Button
              type="submit"
              size="icon"
              disabled={streaming || !input.trim()}
            >
              {streaming ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  // Spezial-Renderer für find_matches-Result: prominente 'Treffer ansehen'-Card
  const matchTool = message.toolCalls?.find(
    (t) => t.name === "find_matches" && t.result?.ok
  );

  return (
    <div className={isUser ? "flex justify-end" : "flex flex-col items-start"}>
      <div
        className={
          "rounded-2xl px-4 py-2 max-w-[85%] whitespace-pre-wrap text-sm " +
          (isUser
            ? "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-br-sm"
            : "bg-[var(--accent)] text-[var(--accent-foreground)] rounded-bl-sm")
        }
      >
        {message.content || (isUser ? "" : "…")}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-1 text-xs opacity-70"
              >
                <Wrench className="size-3" />
                <code>{t.name}</code>
                {t.result && t.result.ok && <Check className="size-3" />}
                {t.result && !t.result.ok && (
                  <>
                    <X className="size-3" />
                    <span className="truncate">{t.result.error}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!isUser && matchTool && (
        <Link
          href="/matches"
          className="mt-2 max-w-[85%] w-full sm:w-auto sm:min-w-[280px] flex items-center justify-between gap-3 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-white px-4 py-3 hover:border-rose-300 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="size-9 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
              <Search className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                Treffer ansehen
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Bilder, Karten, alle Details — wisch dich durch
              </div>
            </div>
          </div>
          <ArrowRight className="size-4 text-rose-700 group-hover:translate-x-0.5 transition-transform shrink-0" />
        </Link>
      )}
    </div>
  );
}

# Home4U — App

KI-gestützte Immobilienplattform mit Double-Match-Prinzip. Sophie ist die
KI-Assistentin, die Suchende, private Eigentümer und Makler zusammenbringt.
Startmarkt: Limassol, Zypern.

Dieses Repo enthält das Next.js-Frontend + Sophie-Chat-API. Das Whitepaper und
der Umsetzungsplan liegen im übergeordneten `Home4U/`-Verzeichnis.

## Stack

- Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript
- Anthropic Claude (Sonnet 4.6 default, Opus 4.7, Haiku 4.5)
- Supabase (Postgres + pgvector + Auth)
- OpenAI `text-embedding-3-small` für Semantic Matching

## Setup

```bash
# 1. Dependencies
npm install

# 2. Secrets
cp .env.example .env.local
# ANTHROPIC_API_KEY eintragen; Supabase-Vars für DB-Features (optional Step 1)

# 3. Dev-Server
npm run dev
```

Landing: http://localhost:3000 · Chat: http://localhost:3000/chat

## Ordnerstruktur

```
app/
  page.tsx                 Landing-Page mit 3 Einstiegs-Pfaden
  chat/page.tsx            Sophie-Chat-Seite
  api/chat/route.ts        Anthropic-Streaming-Endpoint (NDJSON)
components/
  ui/                      Basis-Komponenten (Button, Card, Input, Textarea)
  chat/ChatView.tsx        Chat-UI mit Streaming + Tool-Use-Anzeige
lib/
  anthropic.ts             Client-Factory + Modell-IDs (ENV-überschreibbar)
  sophie/system-prompt.ts  Sophies System-Prompt (versioniert)
  sophie/tools.ts          Tool-Definitionen mit JSON-Schema
  supabase/client.ts       Browser-Client
  supabase/server.ts       Server-Client (inkl. Service-Role-Variante)
supabase/
  config.toml              Supabase-CLI-Config
  migrations/0001_*.sql    Initial-Schema (users, conversations, listings,
                           search_profiles, matches, moderation_queue,
                           outreach, llm_usage, opt_outs)
```

## Was funktioniert jetzt

- Landing-Page mit drei Einstiegen (Suchender / Eigentümer / Makler)
- `/chat` → POST `/api/chat` → Anthropic-Streaming mit Prompt-Caching
- Sophie-Tool-Use wird im UI als Chip angezeigt, Backend führt Tools noch
  nicht aus (Supabase-Integration ist der nächste Schritt)
- Supabase-Migrations liegen vor, müssen per `supabase db push` oder gegen
  einen Hosted-Supabase-Projekt ausgeführt werden

## Was noch fehlt (Reihenfolge)

1. Auth (Supabase Magic Link) + Conversation-Persistenz
2. Tool-Executor: `create_search_profile` etc. schreiben nach Supabase
3. Bulk-Import für Makler (CSV → listings)
4. Matching-Job (pgvector Cosine → matches)
5. FB-Extension + Bazaraki-Crawler (eigene Teilprojekte, s. Umsetzungsplan §2)
6. WhatsApp-Outreach via 360dialog
7. Co-Pilot-Moderation-UI (`/admin/moderation`)

## Umsetzungsplan

Siehe `../Home4U_Umsetzungsplan.md` und `../Home4U_Whitepaper.md` im
übergeordneten Verzeichnis.

## Deploy

Vercel ist vorgesehen. Vor dem ersten Deploy:

- ENV-Vars aus `.env.example` in Vercel-Projekt setzen
- Supabase-Projekt erstellen, Migrations ausführen
- Domain `home4u.ai` in Vercel binden

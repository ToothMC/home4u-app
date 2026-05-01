-- 20260501180000_translation_foundation.sql
--
-- Auto-Übersetzungs-Foundation (AirBnB-Style).
--
-- Ziel: Jeder schreibt in seiner Sprache, jeder liest in seiner Sprache.
-- Sprachen V1: DE, EN, RU, EL. (Chinesisch ist im profiles.preferred_language
-- erlaubt, aber nicht V1-Pflichtsprache für Übersetzungen — Fallback auf EN.)
--
-- Was diese Migration macht:
--   1. match_messages bekommt original_language + translations jsonb
--   2. listings bekommt title_i18n + description_i18n + original_language
--   3. translation_cache — globaler Cache vermeidet Doppel-Übersetzungen
--      identischer Strings (z.B. "Möbliert" / "Furnished" / ...)

-- ============================================================================
-- 1) match_messages — Translation-Spalten
-- ============================================================================
-- (Ersetzt die im Home4U_Messaging_Plan.md Phase 3 vorgesehene Migration 0046)

alter table match_messages
  add column if not exists original_language text
    check (original_language in ('de', 'en', 'ru', 'el')),
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column match_messages.original_language is
  'Sprache der content-Spalte. Wird beim Insert gesetzt (Sender-preferred_language oder Auto-Detect).';
comment on column match_messages.translations is
  'jsonb pro Empfänger-Sprache: {de: "...", en: "...", ru: "...", el: "..."}. '
  'Original-Sprache nicht eingetragen.';

-- ============================================================================
-- 2) listings — i18n-Felder
-- ============================================================================
-- title und description bleiben als Original-Felder erhalten.
-- *_i18n-Spalten halten Übersetzungen in alle 4 Zielsprachen.
-- Render-Pattern: COALESCE(title_i18n->>preferred_language, title)

alter table listings
  add column if not exists title_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists original_language text
    check (original_language in ('de', 'en', 'ru', 'el'));

comment on column listings.title_i18n is
  'jsonb {de,en,ru,el} mit übersetzten Titeln. Original liegt in title; '
  'original_language sagt welche Sprache title hat.';
comment on column listings.description_i18n is
  'jsonb {de,en,ru,el} mit übersetzten Beschreibungen.';

-- ============================================================================
-- 3) translation_cache — globaler Cache
-- ============================================================================

create table if not exists translation_cache (
  -- sha256(source_lang || '|' || source_text) — sourcen sich identische Strings
  -- über User/Kontexte hinweg
  source_hash text not null,
  target_lang text not null check (target_lang in ('de', 'en', 'ru', 'el')),
  translated_text text not null,
  -- für Cache-Invalidation bei Modell-Wechsel
  model text not null default 'claude-haiku-4-5',
  context text check (context in ('chat', 'listing', 'email', 'system')),
  created_at timestamptz not null default now(),
  primary key (source_hash, target_lang, model)
);

create index if not exists translation_cache_recent_idx
  on translation_cache(created_at desc);

alter table translation_cache enable row level security;
-- Service-role only — Cache-Lookups laufen serverseitig

comment on table translation_cache is
  'Globaler Übersetzungs-Cache. Vermeidet Doppel-API-Calls für identische '
  'Strings (Domain-Begriffe, Standard-Phrasen, gleiche User-Inputs).';

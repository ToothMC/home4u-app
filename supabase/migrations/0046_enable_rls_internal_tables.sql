-- 0046_enable_rls_internal_tables.sql
--
-- SECURITY FIX (Supabase-Advisor ERROR-Level): vier Tabellen waren ohne
-- RLS in der public schema — anyone mit Project-URL hätte sie lesen +
-- bearbeiten + löschen können (rls_disabled_in_public).
--
-- Alle vier sind reine Server-/Admin-Tabellen — keine Public-/Auth-User
-- Schreib-/Lese-Operationen sollen je passieren. Service-Role bypasst
-- RLS standardmäßig, also bleibt die App-Funktionalität erhalten.
--
-- Keine Policies = keine Zugänge außer für Service-Role. Das ist Absicht.

alter table moderation_queue enable row level security;
alter table outreach enable row level security;
alter table opt_outs enable row level security;
alter table llm_usage enable row level security;

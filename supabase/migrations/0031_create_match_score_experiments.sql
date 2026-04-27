-- Match-Score-Experiments (Indexer-Spec v2.0 §7.2).
--
-- Die Match-Score-Formel ist
--   match_score = w_cosine × cosine_sim
--               + w_hard   × hard_match_ratio
--               + w_scam   × (1 - scam_score)
-- mit Startwerten (0.6 / 0.3 / 0.1). Diese Tabelle hält benannte
-- Gewichts-Varianten für A/B-Tuning, ohne RPC-Re-Deploy.
--
-- Konvention:
--   - variant_id 'default' ist immer die aktive Default-Variante; wird
--     genutzt, wenn p_variant_id NULL ist oder der Lookup fehlschlägt.
--   - weights ist jsonb-Objekt mit Keys cosine|hard|scam, alle in [0,1].
--     Summe muss nicht 1 ergeben (Score wird sowieso auf [0,1] gecapped).

create table if not exists match_score_experiments (
  variant_id text primary key,
  weights jsonb not null,
  description text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Einfacher Sanity-Check: weights muss die drei Keys haben
  constraint match_score_weights_keys
    check (
      weights ? 'cosine' and weights ? 'hard' and weights ? 'scam'
    ),
  -- Werte in [0,1]
  constraint match_score_weights_range check (
    (weights->>'cosine')::numeric between 0 and 1
    and (weights->>'hard')::numeric between 0 and 1
    and (weights->>'scam')::numeric between 0 and 1
  )
);

create index if not exists match_score_experiments_active_idx
  on match_score_experiments(started_at desc) where ended_at is null;

alter table match_score_experiments enable row level security;
-- Nur service_role schreibt; lookup-RPC ist security definer und liest mit.

-- Default-Variante seeden (Spec §7.2 Startwerte). Idempotent.
insert into match_score_experiments (variant_id, weights, description, ended_at)
values (
  'default',
  '{"cosine": 0.6, "hard": 0.3, "scam": 0.1}'::jsonb,
  'Indexer-Spec v2.0 §7.2 Startwerte (cosine=0.6, hard=0.3, scam=0.1).',
  null
)
on conflict (variant_id) do nothing;

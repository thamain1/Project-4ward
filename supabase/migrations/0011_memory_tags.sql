-- Mnemosyne — 0011: memory_entries tags (Unit B+.2). Additive. UNAPPLIED until Aegis QC + Jesse go.
-- Adds a free-form tag array used by the dashboard for exact grouping + the reusable code-snippet library:
--   project:<slug>   — exact project assignment (vs the frontend name heuristic)
--   repo:<name>      — owning repo (for the "which repo" card badge)
--   reusable / code-snippet / pattern — cross-project reusable reference building blocks
-- Read-only consumers (dashboard) read tags via the existing RLS SELECT on memory_entries — no new grant.
-- Tags are written ONLY by service-role backfill / the (future) remember path; no user-facing write here.

alter table public.memory_entries add column if not exists tags text[] not null default '{}';

-- GIN index for tag-contains filtering (e.g. tags @> '{reusable}', tags && '{project:onthehash}').
create index if not exists idx_memory_entries_tags on public.memory_entries using gin (tags);

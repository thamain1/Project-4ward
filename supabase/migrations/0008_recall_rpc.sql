-- Project 4ward — 0008: read-only semantic recall RPC for the 4ward-brain MCP server.
-- Additive. UNAPPLIED until QC sign-off. SECURITY DEFINER, READ-ONLY (SELECT only — no writes).
-- The caller (MCP server, data plane) supplies the query embedding (768-d, gemini-embedding-001 with
-- taskType RETRIEVAL_QUERY); this function does the cosine search across entry-level + chunk-level
-- vectors and returns top-k with provenance + freshness (best vector per entry, deduped).
--
-- Cosine similarity uses pgvector's `<=>` distance operator via `OPERATOR(public.<=>)` (similarity =
-- 1 - distance). Under the empty search_path this explicit operator form is required (operator names
-- are not resolved by dotted schema qualification). Verified on the live DB (qdugyduthemcrmtvgqek): the
-- `vector` extension — and its `<=>` operator for (vector, vector) — live in `public`, as do all
-- referenced tables/types, so every `public.*` reference resolves. (Replaces an earlier
-- `public.cosine_distance(...)` call per Aegis QC; the operator is canonical and index-aware.)

create or replace function public.recall_memory(query_embedding public.vector(768), match_count int default 8)
returns table (
  name text, title text, kind public.memory_kind, source_path text,
  similarity double precision, updated_at timestamptz, matched_via text
)
language sql stable security definer set search_path = '' as $$
  with hits as (
    select e.name, e.title, e.kind, e.source_path, e.updated_at,
           1 - (e.embedding OPERATOR(public.<=>) query_embedding) as similarity, 'entry'::text as matched_via
    from public.memory_entries e
    where e.embedding is not null
    union all
    select e.name, e.title, e.kind, e.source_path, e.updated_at,
           1 - (c.embedding OPERATOR(public.<=>) query_embedding) as similarity, 'chunk'::text as matched_via
    from public.memory_chunks c
    join public.memory_entries e on e.id = c.memory_entry_id
  ),
  best as (
    select distinct on (name) name, title, kind, source_path, updated_at, similarity, matched_via
    from hits
    order by name, similarity desc
  )
  select name, title, kind, source_path, similarity, updated_at, matched_via
  from best
  order by similarity desc
  limit least(greatest(coalesce(match_count, 8), 1), 50);   -- clamp 1..50
$$;

-- Read-only RPC: execute only to service_role for the interim LOCAL single-operator MCP server
-- (service-role key never distributed to teammates).
-- Phase-2 (per-user): NOTE this function is SECURITY DEFINER and therefore BYPASSES caller RLS — simply
-- granting it to `authenticated` would NOT make reads RLS-aware. The correct per-user path is a
-- SECURITY INVOKER recall function backed by RLS SELECT policies, OR explicit in-function authorization
-- (verify is_team_member() + per-user scoping). See docs/MCP-DESIGN.md.
revoke execute on function public.recall_memory(public.vector, int) from public, anon, authenticated;
grant  execute on function public.recall_memory(public.vector, int) to service_role;

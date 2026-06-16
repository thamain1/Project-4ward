-- Mnemosyne — 0012: read-only semantic search over documents (Sales Factory C1). Additive. UNAPPLIED
-- until Aegis QC + Jesse go. Mirrors recall_memory (0008): the caller supplies a 768-d query embedding
-- (gemini-embedding-001, RETRIEVAL_QUERY); this fn cosine-searches document_chunks (joined to documents)
-- and returns top-k with provenance + freshness, best chunk per document (deduped).
--
-- Cosine via pgvector `<=>` operator as OPERATOR(public.<=>) (required under empty search_path; vector
-- extension lives in public). METADATA ONLY — never returns extracted_text/content (mirrors recall's
-- 7-field discipline; bodies are read separately under RLS by an authenticated member).

create or replace function public.search_docs(query_embedding public.vector(768), match_count int default 8)
returns table (
  id uuid, title text, doc_type public.doc_kind, project_id uuid,
  similarity double precision, created_at timestamptz, matched_via text
)
language sql stable security definer set search_path = '' as $$
  with hits as (
    select d.id, d.title, d.doc_type, d.project_id, d.created_at,
           1 - (c.embedding OPERATOR(public.<=>) query_embedding) as similarity, 'chunk'::text as matched_via
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where c.embedding is not null
  ),
  best as (
    select distinct on (id) id, title, doc_type, project_id, created_at, similarity, matched_via
    from hits
    order by id, similarity desc
  )
  select id, title, doc_type, project_id, similarity, created_at, matched_via
  from best
  order by similarity desc
  limit least(greatest(coalesce(match_count, 8), 1), 50);   -- clamp 1..50
$$;

-- Read-only RPC: execute only to service_role (the dashboard endpoint calls it server-side). The function
-- is SECURITY DEFINER and bypasses caller RLS — the dashboard endpoint does the member authz before calling
-- (mirrors recall_memory's interim model). Phase-2 per-user path = SECURITY INVOKER + RLS or in-fn authz.
revoke execute on function public.search_docs(public.vector, int) from public, anon, authenticated;
grant  execute on function public.search_docs(public.vector, int) to service_role;

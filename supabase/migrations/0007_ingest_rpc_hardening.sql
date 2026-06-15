-- Project 4ward — 0007: ingest RPC hardening (Aegis round-3/4/5 reviews). Additive. UNAPPLIED until
-- QC sign-off. Does NOT edit live 0006 (create-or-replace + additive column + drop/recreate of
-- start_ingestion_run whose signature changes to carry the embed run id).
--
-- Enforces: normalized vectors (public.vector_norm; reject zero/non-unit), strict memory/<file>.md path
-- tied to slug, chunks-array + per-chunk key/type/non-null checks BEFORE casts, link-element types,
-- embed_run_id provenance, p_kind='memory' boundary, and exact nonnegative-integer embed_counts.

alter table public.ingestion_runs add column if not exists embed_run_id text;

drop function if exists public.start_ingestion_run(text, jsonb);
drop function if exists public.start_ingestion_run(text, text, jsonb);
create or replace function public.start_ingestion_run(p_kind text, p_embed_run_id text, p_embed_counts jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_kind is distinct from 'memory' then raise exception 'unsupported run kind: %', p_kind; end if;
  if p_embed_run_id is null or p_embed_run_id = '' then raise exception 'missing embed_run_id'; end if;
  if jsonb_typeof(p_embed_counts) is distinct from 'object' then raise exception 'embed_counts must be an object'; end if;
  if (select count(*) from jsonb_object_keys(p_embed_counts)) <> 6
     or exists (select 1 from jsonb_object_keys(p_embed_counts) k
                where k not in ('accepted','quarantined','skipped','failed','embedded_vectors','chunk_rows')) then
    raise exception 'embed_counts must have exactly the six allowed keys';
  end if;
  -- nonnegative integers within the shared MAX_COUNT ceiling (1_000_000); matches Node MAX_COUNT.
  if exists (select 1 from jsonb_each(p_embed_counts) e
             where jsonb_typeof(e.value) <> 'number'
                or e.value::text ~ '[.eE]'                       -- reject fractions / exponent forms
                or e.value::numeric < 0
                or e.value::numeric <> floor(e.value::numeric)
                or e.value::numeric > 1000000) then
    raise exception 'embed_counts values must be nonnegative integers <= 1000000';
  end if;
  insert into public.ingestion_runs (kind, status, counts, embed_run_id)
    values (p_kind, 'running', p_embed_counts, p_embed_run_id)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.ingest_memory_entry(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name  text := payload->>'name';
  v_kind  text := payload->>'kind';
  v_model text := payload->>'embedding_model';
  v_path  text := payload->>'source_path';
  v_emb   text := payload->>'embedding';
  v_slug  text;
  v_has_chunks boolean;
  v_chunk jsonb;
  v_expected int := 0;
  v_norm double precision;
begin
  if exists (select 1 from jsonb_object_keys(payload) k
             where k not in ('name','kind','title','body','links','source_path','embedding_model','embedding','chunks')) then
    raise exception 'ingest_memory_entry: unexpected key in payload';
  end if;
  if v_name is null or v_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'bad name: %', v_name; end if;
  if v_kind not in ('user','feedback','project','reference') then raise exception 'bad kind: %', v_kind; end if;
  if v_model is distinct from 'gemini-embedding-001' then raise exception 'bad embedding_model'; end if;
  if coalesce(payload->>'title','') = '' then raise exception 'missing title'; end if;
  if coalesce(payload->>'body','')  = '' then raise exception 'missing body'; end if;
  if jsonb_typeof(payload->'links') is distinct from 'array' then raise exception 'links must be an array'; end if;
  if exists (select 1 from jsonb_array_elements(payload->'links') e where jsonb_typeof(e) <> 'string') then raise exception 'links must contain only strings'; end if;

  if v_path is null or v_path !~ '^memory/[A-Za-z0-9._-]+\.md$' then raise exception 'bad source_path'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(regexp_replace(substring(v_path from '^memory/(.*)$'), '\.md$', '', 'i')), '[^a-z0-9]+', '-', 'g'));
  if v_slug is distinct from v_name then raise exception 'source_path slug (%) != name (%)', v_slug, v_name; end if;

  if jsonb_typeof(payload->'chunks') is distinct from 'array' then raise exception 'chunks must be an array'; end if;
  v_has_chunks := jsonb_array_length(payload->'chunks') > 0;

  if v_has_chunks then
    if v_emb is not null then raise exception 'chunked entry must have null embedding'; end if;
    for v_chunk in select value from jsonb_array_elements(payload->'chunks') as value loop
      -- require every chunk key with the right JSON type BEFORE any cast (reject missing/null fields)
      if not (v_chunk ? 'chunk_index' and v_chunk ? 'content' and v_chunk ? 'embedding' and v_chunk ? 'embedding_model') then raise exception 'chunk missing a required key'; end if;
      if exists (select 1 from jsonb_object_keys(v_chunk) k where k not in ('chunk_index','content','embedding','embedding_model')) then raise exception 'unexpected key in chunk'; end if;
      if jsonb_typeof(v_chunk->'chunk_index') <> 'number' then raise exception 'chunk_index must be a number'; end if;
      -- exact nonnegative integer within range BEFORE the ::int cast (reject fractional/exponent/negative/out-of-range)
      if (v_chunk->'chunk_index')::text ~ '[.eE]'
         or (v_chunk->>'chunk_index')::numeric < 0
         or (v_chunk->>'chunk_index')::numeric <> floor((v_chunk->>'chunk_index')::numeric)
         or (v_chunk->>'chunk_index')::numeric > 1000000 then raise exception 'chunk_index must be a nonnegative integer <= 1000000'; end if;
      if jsonb_typeof(v_chunk->'content') <> 'string' or v_chunk->>'content' = '' then raise exception 'chunk content must be a non-empty string'; end if;
      if jsonb_typeof(v_chunk->'embedding') <> 'string' then raise exception 'chunk embedding must be a non-null string'; end if;
      if jsonb_typeof(v_chunk->'embedding_model') <> 'string' or (v_chunk->>'embedding_model') <> 'gemini-embedding-001' then raise exception 'bad chunk embedding_model'; end if;
      if (v_chunk->>'chunk_index')::int <> v_expected then raise exception 'non-contiguous chunk_index (expected %)', v_expected; end if;
      if public.vector_dims((v_chunk->>'embedding')::public.vector) <> 768 then raise exception 'chunk embedding not 768-dim'; end if;
      v_norm := public.vector_norm((v_chunk->>'embedding')::public.vector);
      if v_norm = 0 or abs(v_norm - 1) > 1e-3 then raise exception 'chunk embedding not unit-normalized (norm=%)', v_norm; end if;
      v_expected := v_expected + 1;
    end loop;
  else
    if jsonb_typeof(payload->'embedding') is distinct from 'string' then raise exception 'unchunked entry needs a non-null string embedding'; end if;
    if public.vector_dims((v_emb)::public.vector) <> 768 then raise exception 'embedding not 768-dim'; end if;
    v_norm := public.vector_norm((v_emb)::public.vector);
    if v_norm = 0 or abs(v_norm - 1) > 1e-3 then raise exception 'embedding not unit-normalized (norm=%)', v_norm; end if;
  end if;

  insert into public.memory_entries (name, kind, title, body, links, source_path, embedding_model, embedding)
  values (
    v_name, v_kind::public.memory_kind, payload->>'title', payload->>'body',
    coalesce((select array_agg(value) from jsonb_array_elements_text(payload->'links') as value), '{}'),
    v_path, v_model,
    case when v_has_chunks then null else (v_emb)::public.vector end
  )
  on conflict (name) do update set
    kind = excluded.kind, title = excluded.title, body = excluded.body, links = excluded.links,
    source_path = excluded.source_path, embedding_model = excluded.embedding_model,
    embedding = excluded.embedding, updated_at = now()
  returning id into v_id;

  delete from public.memory_chunks where memory_entry_id = v_id;
  if v_has_chunks then
    insert into public.memory_chunks (memory_entry_id, chunk_index, content, embedding, embedding_model)
    select v_id, (c->>'chunk_index')::int, c->>'content', (c->>'embedding')::public.vector, c->>'embedding_model'
    from jsonb_array_elements(payload->'chunks') as c;
  end if;
end $$;

revoke execute on function public.start_ingestion_run(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.ingest_memory_entry(jsonb)             from public, anon, authenticated;
grant  execute on function public.start_ingestion_run(text, text, jsonb) to service_role;
grant  execute on function public.ingest_memory_entry(jsonb)             to service_role;

-- Project 4ward — 0006: transactional, self-validating ingest RPCs + constraints (Phase 1 round-3)
-- Additive, re-runnable. Closes Aegis thread-0002 round-3 blockers: per-entry atomicity (#4), persist
-- trusting an unvalidated artifact (#2 — the RPC self-validates independent of the Node validator), and
-- the run-lifecycle/constraint follow-ups. The persist phase performs ALL writes through these hardened
-- RPCs (no direct table writes), so a scoped/limited persistence credential could replace service-role.

-- ── constraints (Aegis follow-ups) ──
do $$ begin
  alter table public.memory_chunks add constraint memory_chunks_chunk_index_nonneg check (chunk_index >= 0);
exception when duplicate_object then null; end $$;

alter table public.ingestion_runs add column if not exists finished_at timestamptz;
do $$ begin
  alter table public.ingestion_runs
    add constraint ingestion_runs_status_chk check (status in ('running','success','partial','failed'));
exception when duplicate_object then null; end $$;

-- ── run lifecycle RPCs ──
create or replace function public.start_ingestion_run(p_kind text, p_embed_counts jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.ingestion_runs (kind, status, counts)
    values (p_kind, 'running', coalesce(p_embed_counts, '{}'::jsonb))
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.finish_ingestion_run(p_id uuid, p_status text, p_counts jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('success','partial','failed') then raise exception 'invalid status %', p_status; end if;
  update public.ingestion_runs
    set status = p_status,
        counts = public.ingestion_runs.counts || coalesce(p_counts, '{}'::jsonb),
        finished_at = now()
    where id = p_id;
  if not found then raise exception 'ingestion_run % not found', p_id; end if;
end $$;

-- ── transactional, SELF-VALIDATING entry upsert + chunk reconcile ──
create or replace function public.ingest_memory_entry(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name  text := payload->>'name';
  v_kind  text := payload->>'kind';
  v_model text := payload->>'embedding_model';
  v_emb   text := payload->>'embedding';
  v_has_chunks boolean := jsonb_typeof(payload->'chunks') = 'array' and jsonb_array_length(payload->'chunks') > 0;
  v_chunk jsonb;
  v_expected int := 0;
begin
  -- reject unexpected keys (do not trust the artifact just because it reached here)
  if exists (select 1 from jsonb_object_keys(payload) k
             where k not in ('name','kind','title','body','links','source_path','embedding_model','embedding','chunks')) then
    raise exception 'ingest_memory_entry: unexpected key in payload';
  end if;
  if v_name is null or v_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'bad name: %', v_name; end if;
  if v_kind not in ('user','feedback','project','reference') then raise exception 'bad kind: %', v_kind; end if;
  if v_model is distinct from 'gemini-embedding-001' then raise exception 'bad embedding_model: %', v_model; end if;
  if coalesce(payload->>'title','') = '' then raise exception 'missing title'; end if;
  if coalesce(payload->>'body','') = '' then raise exception 'missing body'; end if;
  if jsonb_typeof(payload->'links') is distinct from 'array' then raise exception 'links must be an array'; end if;
  if (payload->>'source_path') is null or (payload->>'source_path') !~ '^memory/' then raise exception 'bad source_path'; end if;

  if v_has_chunks then
    if v_emb is not null then raise exception 'chunked entry must have null embedding'; end if;
    for v_chunk in select value from jsonb_array_elements(payload->'chunks') as value loop
      if (v_chunk->>'chunk_index')::int <> v_expected then raise exception 'non-contiguous chunk_index (expected %)', v_expected; end if;
      if coalesce(v_chunk->>'content','') = '' then raise exception 'empty chunk content'; end if;
      if (v_chunk->>'embedding_model') is distinct from 'gemini-embedding-001' then raise exception 'bad chunk embedding_model'; end if;
      if public.vector_dims((v_chunk->>'embedding')::public.vector) <> 768 then raise exception 'chunk embedding not 768-dim'; end if;
      v_expected := v_expected + 1;
    end loop;
  else
    if v_emb is null then raise exception 'unchunked entry must carry a 768-dim embedding'; end if;
    if public.vector_dims((v_emb)::public.vector) <> 768 then raise exception 'embedding not 768-dim'; end if;
  end if;

  insert into public.memory_entries (name, kind, title, body, links, source_path, embedding_model, embedding)
  values (
    v_name, v_kind::public.memory_kind, payload->>'title', payload->>'body',
    coalesce((select array_agg(value) from jsonb_array_elements_text(payload->'links') as value), '{}'),
    payload->>'source_path', v_model,
    case when v_has_chunks then null else (v_emb)::public.vector end
  )
  on conflict (name) do update set
    kind = excluded.kind, title = excluded.title, body = excluded.body, links = excluded.links,
    source_path = excluded.source_path, embedding_model = excluded.embedding_model,
    embedding = excluded.embedding, updated_at = now()
  returning id into v_id;

  -- always reconcile chunks (delete all, then insert if chunked) — fixes stale-chunk bug (#3), atomic (#4)
  delete from public.memory_chunks where memory_entry_id = v_id;
  if v_has_chunks then
    insert into public.memory_chunks (memory_entry_id, chunk_index, content, embedding, embedding_model)
    select v_id, (c->>'chunk_index')::int, c->>'content', (c->>'embedding')::public.vector, c->>'embedding_model'
    from jsonb_array_elements(payload->'chunks') as c;
  end if;
end $$;

-- ── harden: empty search_path (above), revoke PUBLIC/anon/authenticated, grant only the persistence role ──
revoke execute on function public.start_ingestion_run(text, jsonb)        from public, anon, authenticated;
revoke execute on function public.finish_ingestion_run(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.ingest_memory_entry(jsonb)              from public, anon, authenticated;
grant  execute on function public.start_ingestion_run(text, jsonb)        to service_role;
grant  execute on function public.finish_ingestion_run(uuid, text, jsonb) to service_role;
grant  execute on function public.ingest_memory_entry(jsonb)              to service_role;

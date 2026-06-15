-- Project 4ward — 0009: MCP write subsystem (Aegis 0007/0008 reviews). Additive. UNAPPLIED until QC.
-- Two SECURITY DEFINER, empty-search_path, fully-qualified, service_role-only RPCs:
--   * log_activity(...)     — hardened append-only audit insert (the log_update tool + reused by remember).
--   * remember_memory(...)  — ATOMIC operator-authored memory upsert + audit in ONE transaction, with a
--     distinct operator provenance (mcp/<slug>, NOT memory/<file>.md) and a no-silent-overwrite collision
--     policy so it can never replace a file-backed canonical entry. Bounded chunk count.
-- Actor is a server-configured ACTIVE team_members.id (fail closed). No update/delete/truncate path.

-- ── log_activity: append-only audit ───────────────────────────────────────────
create or replace function public.log_activity(p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_detail jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  -- ONE high-signal secret pattern reused across entity_type + detail keys + detail string values
  -- (Aegis r2 #2). Mirrors the Node scanSecret set; includes Slack xox-.
  c_secret_re constant text := '(sk_(live|test)_[A-Za-z0-9]|sbp_[A-Za-z0-9]{20}|sb_(secret|publishable)_|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{30}|-----BEGIN [A-Z ]*PRIVATE KEY-----)';
begin
  -- actor: must be an ACTIVE team member; never NULL/forged for operator writes (fail closed)
  if p_actor is null or not exists (select 1 from public.team_members where id = p_actor and active) then
    raise exception 'log_activity: actor must be an active team member';
  end if;
  -- action: bounded namespaced token; human narrative belongs in detail
  if p_action is null or length(p_action) > 200 or p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' then
    raise exception 'log_activity: action must match ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ and be <=200 chars';
  end if;
  if p_entity_type is not null then
    if length(p_entity_type) > 100 then raise exception 'log_activity: entity_type too long'; end if;
    if p_entity_type ~* c_secret_re then
      raise exception 'log_activity: entity_type appears to contain a secret';
    end if;
  end if;
  -- detail: top-level object, bounded BYTE size/keys, FLAT (no nested object/array), bounded string values
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then raise exception 'log_activity: detail must be a JSON object'; end if;
  if octet_length(p_detail::text) > 4096 then raise exception 'log_activity: detail exceeds 4096 bytes'; end if;
  if (select count(*) from jsonb_object_keys(p_detail)) > 30 then raise exception 'log_activity: detail has too many keys (>30)'; end if;
  if exists (select 1 from jsonb_each(p_detail) e where jsonb_typeof(e.value) in ('object','array')) then
    raise exception 'log_activity: detail must be flat (no nested objects/arrays)';
  end if;
  if exists (select 1 from jsonb_each(p_detail) e where jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 1000) then
    raise exception 'log_activity: detail string value too long (>1000)';
  end if;
  -- defense-in-depth secret scan (high-signal prefixes) over keys + string values; full recursive scan is
  -- in the Node layer, this is the DB backstop.
  if exists (
    select 1 from jsonb_each(p_detail) e
    where e.key ~* c_secret_re
       or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~* c_secret_re)
  ) then
    raise exception 'log_activity: detail appears to contain a secret';
  end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, detail)
    values (p_actor, p_action, p_entity_type, p_entity_id, p_detail)
    returning id into v_id;
  return v_id;
end $$;

-- ── remember_memory: ATOMIC operator-authored memory upsert + audit ────────────
create or replace function public.remember_memory(p_payload jsonb, p_actor uuid, p_audit jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name  text := p_payload->>'name';
  v_kind  text := p_payload->>'kind';
  v_model text := p_payload->>'embedding_model';
  v_path  text := p_payload->>'source_path';
  v_emb   text := p_payload->>'embedding';
  v_slug  text;
  v_has_chunks boolean;
  v_chunk jsonb;
  v_expected int := 0;
  v_norm double precision;
  c_max_chunks constant int := 12;   -- hard fan-out bound (Aegis 0007 #3)
begin
  -- actor: active team member, fail closed (validated again inside log_activity; checked early to avoid work)
  if p_actor is null or not exists (select 1 from public.team_members where id = p_actor and active) then
    raise exception 'remember_memory: actor must be an active team member';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k
             where k not in ('name','kind','title','body','links','source_path','embedding_model','embedding','chunks')) then
    raise exception 'remember_memory: unexpected key in payload';
  end if;
  if v_name is null or v_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_name) > 80 then raise exception 'bad name: %', v_name; end if;
  if v_kind is null or v_kind not in ('user','feedback','project','reference') then raise exception 'bad kind: %', v_kind; end if;
  if v_model is distinct from 'gemini-embedding-001' then raise exception 'bad embedding_model'; end if;
  if jsonb_typeof(p_payload->'title') is distinct from 'string' or p_payload->>'title' = '' then raise exception 'title must be a non-empty string'; end if;
  if jsonb_typeof(p_payload->'body')  is distinct from 'string' or p_payload->>'body'  = '' then raise exception 'body must be a non-empty string'; end if;
  if jsonb_typeof(p_payload->'links') is distinct from 'array' then raise exception 'links must be an array'; end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'links') e where jsonb_typeof(e) <> 'string') then raise exception 'links must contain only strings'; end if;

  -- DISTINCT operator provenance: mcp/<slug>, NOT a canonical memory/<file>.md path
  if v_path is null or v_path !~ '^mcp/[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'remember_memory: source_path must be mcp/<slug>'; end if;
  v_slug := substring(v_path from '^mcp/(.*)$');
  if v_slug is distinct from v_name then raise exception 'source_path slug (%) != name (%)', v_slug, v_name; end if;

  if jsonb_typeof(p_payload->'chunks') is distinct from 'array' then raise exception 'chunks must be an array'; end if;
  if jsonb_array_length(p_payload->'chunks') > c_max_chunks then raise exception 'remember_memory: too many chunks (max %)', c_max_chunks; end if;
  v_has_chunks := jsonb_array_length(p_payload->'chunks') > 0;

  if v_has_chunks then
    if v_emb is not null then raise exception 'chunked entry must have null embedding'; end if;
    for v_chunk in select value from jsonb_array_elements(p_payload->'chunks') as value loop
      if not (v_chunk ? 'chunk_index' and v_chunk ? 'content' and v_chunk ? 'embedding' and v_chunk ? 'embedding_model') then raise exception 'chunk missing a required key'; end if;
      if exists (select 1 from jsonb_object_keys(v_chunk) k where k not in ('chunk_index','content','embedding','embedding_model')) then raise exception 'unexpected key in chunk'; end if;
      if jsonb_typeof(v_chunk->'chunk_index') <> 'number' then raise exception 'chunk_index must be a number'; end if;
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
    if jsonb_typeof(p_payload->'embedding') is distinct from 'string' then raise exception 'unchunked entry needs a non-null string embedding'; end if;
    if public.vector_dims((v_emb)::public.vector) <> 768 then raise exception 'embedding not 768-dim'; end if;
    v_norm := public.vector_norm((v_emb)::public.vector);
    if v_norm = 0 or abs(v_norm - 1) > 1e-3 then raise exception 'embedding not unit-normalized (norm=%)', v_norm; end if;
  end if;

  insert into public.memory_entries (name, kind, title, body, links, source_path, embedding_model, embedding)
  values (
    v_name, v_kind::public.memory_kind, p_payload->>'title', p_payload->>'body',
    coalesce((select array_agg(value) from jsonb_array_elements_text(p_payload->'links') as value), '{}'),
    v_path, v_model,
    case when v_has_chunks then null else (v_emb)::public.vector end
  )
  -- ATOMIC ownership policy: update ONLY an existing operator mcp/<slug> entry. A conflict with ANY other
  -- origin (file-backed memory/<file>.md, NULL, or unknown) → WHERE false → no update → v_id null → fail
  -- closed. INSERT...ON CONFLICT locks the conflicting row, so this is concurrency-safe (no check-then-act).
  on conflict (name) do update set
    kind = excluded.kind, title = excluded.title, body = excluded.body, links = excluded.links,
    source_path = excluded.source_path, embedding_model = excluded.embedding_model,
    embedding = excluded.embedding, updated_at = now()
    where public.memory_entries.source_path ~ '^mcp/'
  returning id into v_id;
  if v_id is null then raise exception 'remember_memory: name "%" collides with an entry this tool does not own (not an mcp/ origin); choose a different name', v_name; end if;

  delete from public.memory_chunks where memory_entry_id = v_id;
  if v_has_chunks then
    insert into public.memory_chunks (memory_entry_id, chunk_index, content, embedding, embedding_model)
    select v_id, (c->>'chunk_index')::int, c->>'content', (c->>'embedding')::public.vector, c->>'embedding_model'
    from jsonb_array_elements(p_payload->'chunks') as c;
  end if;

  -- ATOMIC audit in the SAME transaction (Aegis 0007 #2). log_activity re-validates actor + detail; any
  -- failure here raises and rolls back the memory write above. Action is fixed; detail = safe metadata.
  perform public.log_activity(p_actor, 'memory.remember', 'memory_entries', v_id, coalesce(p_audit, '{}'::jsonb));
  return v_id;
end $$;

-- ── ingest_memory_entry: add the REVERSE collision guard (Aegis r1 #1, both directions) ──────────────
-- Identical to 0007 except the ON CONFLICT now updates ONLY file-backed rows, so a bulk file ingest can
-- never silently overwrite an operator-authored mcp/<slug> entry of the same name (it fails closed).
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
  if v_kind is null or v_kind not in ('user','feedback','project','reference') then raise exception 'bad kind: %', v_kind; end if;
  if v_model is distinct from 'gemini-embedding-001' then raise exception 'bad embedding_model'; end if;
  if jsonb_typeof(payload->'title') is distinct from 'string' or payload->>'title' = '' then raise exception 'title must be a non-empty string'; end if;
  if jsonb_typeof(payload->'body')  is distinct from 'string' or payload->>'body'  = '' then raise exception 'body must be a non-empty string'; end if;
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
      if not (v_chunk ? 'chunk_index' and v_chunk ? 'content' and v_chunk ? 'embedding' and v_chunk ? 'embedding_model') then raise exception 'chunk missing a required key'; end if;
      if exists (select 1 from jsonb_object_keys(v_chunk) k where k not in ('chunk_index','content','embedding','embedding_model')) then raise exception 'unexpected key in chunk'; end if;
      if jsonb_typeof(v_chunk->'chunk_index') <> 'number' then raise exception 'chunk_index must be a number'; end if;
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
  -- update ONLY file-backed rows → never silently overwrite an operator mcp/<slug> entry (fail closed)
  on conflict (name) do update set
    kind = excluded.kind, title = excluded.title, body = excluded.body, links = excluded.links,
    source_path = excluded.source_path, embedding_model = excluded.embedding_model,
    embedding = excluded.embedding, updated_at = now()
    where public.memory_entries.source_path ~ '^memory/'
  returning id into v_id;
  if v_id is null then raise exception 'ingest_memory_entry: name "%" collides with a non-file (operator/mcp) entry', v_name; end if;

  delete from public.memory_chunks where memory_entry_id = v_id;
  if v_has_chunks then
    insert into public.memory_chunks (memory_entry_id, chunk_index, content, embedding, embedding_model)
    select v_id, (c->>'chunk_index')::int, c->>'content', (c->>'embedding')::public.vector, c->>'embedding_model'
    from jsonb_array_elements(payload->'chunks') as c;
  end if;
end $$;

revoke execute on function public.log_activity(uuid, text, text, uuid, jsonb)   from public, anon, authenticated;
revoke execute on function public.remember_memory(jsonb, uuid, jsonb)           from public, anon, authenticated;
revoke execute on function public.ingest_memory_entry(jsonb)                    from public, anon, authenticated;
grant  execute on function public.log_activity(uuid, text, text, uuid, jsonb)   to service_role;
grant  execute on function public.remember_memory(jsonb, uuid, jsonb)           to service_role;
grant  execute on function public.ingest_memory_entry(jsonb)                    to service_role;

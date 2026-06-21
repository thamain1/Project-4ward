-- Mnemosyne — 0020: refine the memory_mirror server guard's postgres pattern to exclude PLACEHOLDER
-- connection strings (creds containing < > $ { } * — e.g. postgresql://user:<password>@host, ***, $VAR).
-- Real DSN credentials are URL-encoded and never contain those chars, so this only stops false-positive
-- blocks on documentation placeholders; real conn-strings with embedded creds are still caught. Synced
-- with mcp/lib/remember-core.mjs. Only the postgres alternative in c_secret_re changes vs 0019.
-- Idempotent (create or replace). Additive.

create or replace function public.upsert_memory_mirror(p_payload jsonb, p_actor uuid, p_audit jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id          uuid;
  v_path        text := p_payload->>'source_path';
  v_kind        text := coalesce(p_payload->>'source_kind', 'memory_topic_file');
  v_slug        text := coalesce(p_payload->>'project_slug', 'claude-code-memory');
  v_content     text := p_payload->>'content';
  v_hash        text := p_payload->>'content_hash';
  v_status      text := coalesce(p_payload->>'sync_status', 'current');
  v_existing    uuid;
  v_existing_hash text;
  c_secret_re constant text :=
    '(sk_(live|test)_[A-Za-z0-9]{8,})|(sbp_[A-Za-z0-9]{20,})|(sb_secret_[A-Za-z0-9_]+)|(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,})|(AIza[0-9A-Za-z_-]{30,})|(AKIA[0-9A-Z]{16})|(ghp_[A-Za-z0-9]{30,})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)|(xox[baprs]-[A-Za-z0-9-]{8,})|(whsec_[A-Za-z0-9]{16,})|(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})|(xkeysib-[A-Za-z0-9]{16,})|(postgres(ql)?://[^[:space:]@<>${}*]+:[^[:space:]@<>${}*]+@)';
begin
  if p_actor is null or not exists (select 1 from public.team_members where id = p_actor and active) then
    raise exception 'upsert_memory_mirror: actor must be an active team member';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k
             where k not in ('source_path','source_kind','project_slug','content','content_hash',
                             'byte_size','local_modified_at','branch','commit_sha','sync_status')) then
    raise exception 'upsert_memory_mirror: unexpected key in payload';
  end if;
  if v_path is null or v_path = '' or length(v_path) > 400 then raise exception 'upsert_memory_mirror: source_path must be a non-empty string <=400 chars'; end if;
  if v_path ~ '\.\.' or v_path ~ '^[/\\]' or v_path ~ '^[A-Za-z]:' then raise exception 'upsert_memory_mirror: source_path must be repo-relative (no .. , no absolute path)'; end if;
  if v_kind not in ('memory_index','memory_topic_file','claude_md','other') then raise exception 'upsert_memory_mirror: bad source_kind %', v_kind; end if;
  if v_status not in ('current','stale','failed','unknown') then raise exception 'upsert_memory_mirror: bad sync_status %', v_status; end if;
  if v_content is null or v_content = '' or length(v_content) > 1000000 then raise exception 'upsert_memory_mirror: content must be a non-empty string <=1000000 chars'; end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'upsert_memory_mirror: content_hash must be a 64-char sha256 hex'; end if;
  if encode(extensions.digest(v_content, 'sha256'), 'hex') <> v_hash then raise exception 'upsert_memory_mirror: content_hash does not match content'; end if;
  if v_content ~ c_secret_re then raise exception 'upsert_memory_mirror: content matches a secret pattern — secrets must never be mirrored (scrub the file, use the vault)'; end if;

  select id, content_hash into v_existing, v_existing_hash from public.memory_mirror where source_path = v_path;

  if v_existing is null then
    insert into public.memory_mirror (project_slug, source_path, source_kind, content, content_hash,
                                      byte_size, local_modified_at, branch, commit_sha, sync_status,
                                      created_by, mirror_version, mirrored_at)
      values (v_slug, v_path, v_kind, v_content, v_hash,
              coalesce((p_payload->>'byte_size')::int, octet_length(v_content)),
              (p_payload->>'local_modified_at')::timestamptz, p_payload->>'branch', p_payload->>'commit_sha',
              v_status, p_actor, 1, now())
      returning id into v_id;
  else
    update public.memory_mirror set
      project_slug = v_slug, source_kind = v_kind, content = v_content, content_hash = v_hash,
      byte_size = coalesce((p_payload->>'byte_size')::int, octet_length(v_content)),
      local_modified_at = (p_payload->>'local_modified_at')::timestamptz,
      branch = p_payload->>'branch', commit_sha = p_payload->>'commit_sha', sync_status = v_status,
      mirror_version = mirror_version + (case when content_hash is distinct from v_hash then 1 else 0 end),
      mirrored_at = now(), updated_at = now()
      where id = v_existing
      returning id into v_id;
  end if;

  perform public.log_activity(p_actor, 'memory.mirror_upsert', 'memory_mirror', v_id, coalesce(p_audit, '{}'::jsonb));
  return v_id;
end $$;

revoke execute on function public.upsert_memory_mirror(jsonb, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.upsert_memory_mirror(jsonb, uuid, jsonb) to service_role;

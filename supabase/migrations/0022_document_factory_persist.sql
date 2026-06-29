-- Mnemosyne — 0022: Document Factory persistence (thread 0023, Phase D). Additive. UNAPPLIED until Aegis QC.
--
-- Persist a factory-RENDERED document (the server-produced PDF + its markdown source) into Storage + the
-- documents table, append-only versioned, attachable to a CRM deal. Download-only (no RAG embedding in this
-- slice, per Jesse). Aegis Phase-D controls (b9e5252) baked in:
--   * private bucket `documents` (NOT public); no anon/authenticated Storage policies → only service_role
--     (RLS-bypassing, server-side) can read/write objects; browser never gets a Storage key.
--   * doc_kind extended additively (+5 factory types); documents_origin_chk replaced to add 'rendered'.
--   * document_versions: append-only prior-state history (mirrors memory_versions/0021), RLS-on, NO client
--     select policy, explicit revoke from anon/authenticated (this project auto-grants new public tables).
--   * save_rendered_document: SECURITY DEFINER, empty search_path, service_role-only. INSERT-ONLY first path
--     (each save = new document + v1 snapshot) — sidesteps version-conflict/overwrite; validates optional
--     deal_id inside the RPC; atomic audit via log_activity. Actor = caller-passed verified uid (re-checked).
--
-- STORAGE/DB ATOMICITY (Aegis): Storage upload and this RPC are NOT one transaction. The endpoint uses
-- upload→RPC with delete-on-failure cleanup, and object paths are immutable (rendered/{document_id}/v{n}.pdf),
-- so a failed RPC leaves no row and the endpoint deletes the orphan object. The RPC itself is all-or-nothing.

-- ── 1. private Storage bucket ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];
-- NO policies on storage.objects for this bucket → anon/authenticated cannot read/write/list; only the
-- service_role (used server-side by the save/download endpoints) bypasses RLS. (storage.objects has RLS on.)

-- ── 2. doc_kind: add the 5 factory types (additive) ─────────────────────────────────────────────────────
alter type public.doc_kind add value if not exists 'change-order';
alter type public.doc_kind add value if not exists 'white-paper';
alter type public.doc_kind add value if not exists 'use-case';
alter type public.doc_kind add value if not exists 'capabilities-brief';
alter type public.doc_kind add value if not exists 'exec-briefing';

-- ── 3. origin: allow 'rendered' (replace the ingested|draft-only check) ─────────────────────────────────
alter table public.documents drop constraint if exists documents_origin_chk;
alter table public.documents add constraint documents_origin_chk
  check (origin in ('ingested', 'draft', 'rendered'));

-- ── 4. document_versions: append-only prior-state history ───────────────────────────────────────────────
create table if not exists public.document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents (id) on delete cascade,
  version_no    int  not null,
  doc_type      public.doc_kind not null,
  title         text not null,
  storage_path  text not null,
  markdown      text not null,
  audience      text,
  policy        text,
  deal_id       uuid references public.deals (id) on delete set null,
  edited_by     uuid references public.team_members (id),
  change_reason text,
  created_at    timestamptz not null default now(),
  unique (document_id, version_no)
);
create index if not exists idx_document_versions_document on public.document_versions (document_id);

-- service-role-only: prior PDFs/markdown may be sensitive; no client raw read until a scanned RPC exists.
alter table public.document_versions enable row level security;
revoke all on public.document_versions from anon, authenticated;

-- ── 5. save_rendered_document: atomic insert + v1 snapshot + audit ──────────────────────────────────────
-- payload: { id, doc_type, title, storage_path, markdown, audience?, policy?, deal_id? }. The endpoint
-- pre-generates `id` (so it can upload to the immutable path rendered/{id}/v1.pdf BEFORE this RPC), then
-- passes it here; the RPC asserts storage_path == rendered/{id}/v1.pdf and that the id is unused. INSERT-ONLY.
create or replace function public.save_rendered_document(p_payload jsonb, p_actor uuid, p_audit jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_doc_type  text := p_payload->>'doc_type';
  v_title     text := p_payload->>'title';
  v_path      text := p_payload->>'storage_path';
  v_md        text := p_payload->>'markdown';
  v_audience  text := p_payload->>'audience';
  v_policy    text := p_payload->>'policy';
  v_deal      text := p_payload->>'deal_id';
  v_deal_id   uuid;
begin
  -- actor: active team member, fail closed
  if p_actor is null or not exists (select 1 from public.team_members where id = p_actor and active) then
    raise exception 'save_rendered_document: actor must be an active team member';
  end if;
  -- strict payload key allow-list
  if exists (select 1 from jsonb_object_keys(p_payload) k
             where k not in ('id','doc_type','title','storage_path','markdown','audience','policy','deal_id')) then
    raise exception 'save_rendered_document: unexpected key in payload';
  end if;
  -- id: endpoint-generated uuid, must be unused (insert-only — never collide with an existing document)
  begin v_id := (p_payload->>'id')::uuid; exception when others then raise exception 'save_rendered_document: id must be a uuid'; end;
  if v_id is null then raise exception 'save_rendered_document: id required'; end if;
  if exists (select 1 from public.documents where id = v_id) then raise exception 'save_rendered_document: id % already exists', v_id; end if;
  -- field validation
  if v_doc_type is null or v_doc_type not in
     ('mou','sow','invoice','proposal','change-order','white-paper','use-case','capabilities-brief','exec-briefing') then
    raise exception 'save_rendered_document: bad doc_type %', v_doc_type;
  end if;
  if v_title is null or v_title = '' or length(v_title) > 300 then raise exception 'save_rendered_document: bad title'; end if;
  -- storage_path must be the server-shaped immutable path for THIS id
  if v_path is null or v_path <> 'rendered/' || v_id::text || '/v1.pdf' then
    raise exception 'save_rendered_document: storage_path must be rendered/<id>/v1.pdf';
  end if;
  if v_md is null or v_md = '' or length(v_md) > 200000 then raise exception 'save_rendered_document: markdown 1..200000 chars'; end if;
  if v_audience is not null and v_audience not in ('client','internal') then raise exception 'save_rendered_document: bad audience'; end if;
  -- optional deal_id: validate it exists (Aegis #5 — fail before any lasting state)
  if v_deal is not null and v_deal <> '' then
    begin v_deal_id := v_deal::uuid; exception when others then raise exception 'save_rendered_document: deal_id not a uuid'; end;
    if not exists (select 1 from public.deals where id = v_deal_id) then raise exception 'save_rendered_document: deal_id % not found', v_deal_id; end if;
  end if;

  insert into public.documents (id, doc_type, title, storage_path, extracted_text, origin, deal_id, created_by)
  values (v_id, v_doc_type::public.doc_kind, v_title, v_path, v_md, 'rendered', v_deal_id, p_actor);

  -- v1 prior-state snapshot (full restore/audit material per Aegis)
  insert into public.document_versions (document_id, version_no, doc_type, title, storage_path, markdown, audience, policy, deal_id, edited_by, change_reason)
  values (v_id, 1, v_doc_type::public.doc_kind, v_title, v_path, v_md, v_audience, v_policy, v_deal_id, p_actor, nullif(p_audit->>'change_reason',''));

  -- atomic metadata-only audit (no markdown/bytes/url); log_activity re-validates actor + secret-scans detail
  perform public.log_activity(p_actor, 'document.render_save', 'documents', v_id, coalesce(p_audit, '{}'::jsonb));
  return v_id;
end $$;

revoke execute on function public.save_rendered_document(jsonb, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.save_rendered_document(jsonb, uuid, jsonb) to service_role;

-- Mnemosyne — 0014: make document persistence server-mediated by POLICY + GRANT, not convention (Aegis C4.2
-- blocking finding, thread 0018). Additive/tightening. UNAPPLIED until Aegis re-review + Jesse go.
--
-- Problem: documents + document_chunks still carried the survivability-era broad policy
--   `for all using (is_team_member()) with check (is_team_member())`
-- plus the default Data-API grants, so an active member could write rows DIRECTLY via PostgREST — bypassing
-- /api/save-document's scanner, origin='draft', actor attribution, chunk validation, and atomic audit. That
-- defeats the C4.2 safety claim. Fix: members get READ-ONLY on these two tables; all writes go through the
-- service-role RPCs (save_document for drafts; the service-role ingestion path for C1 finals — both bypass RLS).
--
-- Scope is intentionally limited to documents + document_chunks (which now have a dedicated write path). The
-- broader survivability access model on the other tables is unchanged.

-- 1) Replace the broad ALL policies with team-readable SELECT-only policies.
drop policy if exists documents_team_all       on public.documents;
drop policy if exists document_chunks_team_all  on public.document_chunks;

create policy documents_team_select on public.documents
  for select using (public.is_team_member());
create policy document_chunks_team_select on public.document_chunks
  for select using (public.is_team_member());

-- 2) Revoke direct write privileges from the Data-API roles (defense in depth alongside RLS). SELECT remains
--    granted so the dashboard can read. Service role bypasses RLS and is unaffected (used by save_document and
--    the ingestion script).
revoke insert, update, delete on public.documents       from anon, authenticated;
revoke insert, update, delete on public.document_chunks  from anon, authenticated;

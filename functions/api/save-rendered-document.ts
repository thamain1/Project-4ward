// Mnemosyne — Document Factory (thread 0023), Phase D: persist a rendered document.
//
// POST { doc_type, title, markdown, audience?, deal_id?, change_reason? } → { id }.
// Pipeline (Aegis Phase-D controls): requireMember (JWT→active member) → strict args → SERVER-SIDE governed
// render (renderToPdf; never accept client PDF bytes / storage paths) → upload the server-produced PDF to the
// private `documents` bucket at the IMMUTABLE path rendered/{id}/v1.pdf (service-role) → save_rendered_document
// RPC (insert + v1 snapshot + atomic audit). DELETE-ON-FAILURE: if the RPC fails, the just-uploaded object is
// removed so a failed save leaves no orphan. Download-only (no RAG embedding in this slice).
//
// Atomicity: Storage upload + RPC aren't one transaction. Order = upload → RPC → (on RPC failure) delete.
// The path is immutable + keyed to a fresh uuid, so there's no overwrite risk and cleanup is exact.

import { requireMember, parseStrict, json, isUuid } from '../_lib/member-auth'
import { docTypeById } from '../_lib/brand-template'
import { renderToPdf } from '../_lib/render-pdf'

const MAX_TITLE_LEN = 300
const MAX_MARKDOWN_LEN = 200_000
const BUCKET = 'documents'

// crypto.randomUUID is available in the CF Workers runtime
function newId(): string { return crypto.randomUUID() }

export const onRequestPost = async (context: any): Promise<Response> => {
  const auth = await requireMember(context)
  if (!auth.ok) return auth.res
  const env = context.env || {}
  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

  const parsed = await parseStrict(context, ['doc_type', 'title', 'markdown', 'audience', 'deal_id', 'change_reason'])
  if (!parsed.ok) return parsed.res
  const body = parsed.body

  const spec = docTypeById(typeof body.doc_type === 'string' ? body.doc_type : '')
  if (!spec) return json({ error: '"doc_type" must be a known document type' }, 400)
  if (typeof body.markdown !== 'string' || !body.markdown.trim()) return json({ error: '"markdown" must be a non-empty string' }, 400)
  if (body.markdown.length > MAX_MARKDOWN_LEN) return json({ error: `"markdown" exceeds ${MAX_MARKDOWN_LEN} chars` }, 400)
  let title = spec.renderTitle
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: '"title" must be a non-empty string' }, 400)
    if (body.title.length > MAX_TITLE_LEN) return json({ error: `"title" exceeds ${MAX_TITLE_LEN} chars` }, 400)
    title = body.title.trim()
  }
  let audience: 'client' | 'internal' = 'client'
  if (body.audience !== undefined) {
    if (body.audience !== 'client' && body.audience !== 'internal') return json({ error: '"audience" must be "client" or "internal"' }, 400)
    audience = body.audience
  }
  let deal_id: string | undefined
  if (body.deal_id !== undefined && body.deal_id !== null && body.deal_id !== '') {
    if (!isUuid(body.deal_id)) return json({ error: '"deal_id" must be a uuid' }, 400)
    deal_id = body.deal_id
  }
  let change_reason: string | undefined
  if (body.change_reason !== undefined) {
    if (typeof body.change_reason !== 'string') return json({ error: '"change_reason" must be a string' }, 400)
    if (body.change_reason.length > 1000) return json({ error: '"change_reason" exceeds 1000 chars' }, 400)
    change_reason = body.change_reason.trim() || undefined
  }

  // ---- server-side governed render (422/502/503 surface as-is) ----
  const r = await renderToPdf(env, { docTypeId: spec.id, title, markdown: body.markdown, audience })
  if (!r.ok) return json(r.body, r.status)

  // ---- upload to the private bucket at the immutable path ----
  const id = newId()
  const path = `rendered/${id}/v1.pdf`
  const upUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`
  const upRes = await fetch(upUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${SERVICE}`, 'content-type': 'application/pdf', 'x-upsert': 'false' },
    body: r.pdf,
  })
  if (!upRes.ok) {
    const detail = (await upRes.text().catch(() => '')).slice(0, 200)
    return json({ error: 'storage upload failed', detail }, 502)
  }

  // ---- persist row + v1 snapshot + audit; DELETE-ON-FAILURE to avoid an orphan object ----
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const payload: any = { id, doc_type: spec.id, title, storage_path: path, markdown: body.markdown, audience, policy: r.policy }
  if (deal_id) payload.deal_id = deal_id
  const audit: any = { doc_type: spec.id, policy: r.policy }
  if (change_reason) audit.change_reason = change_reason
  if (deal_id) audit.deal_id = deal_id

  const { data, error } = await admin.rpc('save_rendered_document', { p_payload: payload, p_actor: auth.uid, p_audit: audit })
  if (error) {
    // DELETE the just-uploaded object so a failed save leaves no orphan (Storage/DB non-atomic boundary).
    // Observe the cleanup result (Aegis #3): if cleanup itself failed, surface it so callers/smoke can't
    // silently pass while an orphan persists.
    let cleanup = 'ok'
    try {
      const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${SERVICE}` } })
      if (!del.ok) cleanup = `failed(${del.status})`
    } catch (e: any) { cleanup = `failed(${String(e?.message ?? e).slice(0, 60)})` }
    return json({ error: 'save failed', detail: String(error.message).slice(0, 200), cleanup, orphan: cleanup === 'ok' ? null : path }, 502)
  }
  return json({ id: data, doc_type: spec.id, title, storage_path: path }, 200)
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

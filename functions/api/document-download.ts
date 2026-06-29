// Mnemosyne — Document Factory (thread 0023), Phase D: rendered-document download.
//
// POST { id } → { url } (a short-lived signed URL to the private PDF). Aegis Phase-D controls: JWT→active
// member → verify the document row exists AND origin='rendered' AND has a storage_path → issue a 60s signed
// URL only → metadata-only audit. The browser never gets a Storage key; the signed URL is single-document,
// time-boxed, and minted server-side.

import { requireMember, json, isUuid } from '../_lib/member-auth'

const BUCKET = 'documents'
const SIGNED_TTL_SECONDS = 60   // Aegis: tight TTL, ≤120s

export const onRequestPost = async (context: any): Promise<Response> => {
  const auth = await requireMember(context)
  if (!auth.ok) return auth.res
  const env = context.env || {}
  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

  let payload: any
  try { payload = await context.request.json() } catch { return json({ error: 'invalid JSON body' }, 400) }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return json({ error: 'body must be an object' }, 400)
  for (const k of Object.keys(payload)) if (k !== 'id') return json({ error: `unexpected field "${k}"` }, 400)
  if (!isUuid(payload.id)) return json({ error: '"id" must be a uuid' }, 400)

  // verify the document row: must exist, be a rendered doc, and have a storage path
  const { data: doc, error: dErr } = await auth.admin
    .from('documents').select('id, origin, storage_path, title').eq('id', payload.id).maybeSingle()
  if (dErr) return json({ error: 'lookup failed' }, 502)
  if (!doc) return json({ error: 'not found' }, 404)
  if (doc.origin !== 'rendered' || !doc.storage_path) return json({ error: 'not a downloadable rendered document' }, 409)

  // mint a short-lived signed URL (service-role; bucket is private)
  const { data: signed, error: sErr } = await auth.admin.storage.from(BUCKET).createSignedUrl(doc.storage_path, SIGNED_TTL_SECONDS)
  if (sErr || !signed?.signedUrl) return json({ error: 'could not sign url', detail: String(sErr?.message ?? '').slice(0, 200) }, 502)

  // metadata-only audit (no url/bytes/markdown); best-effort — do not fail the download if audit hiccups
  try {
    await auth.admin.rpc('log_activity', {
      p_actor: auth.uid, p_action: 'document.download', p_entity_type: 'documents', p_entity_id: doc.id,
      p_detail: { ttl_seconds: SIGNED_TTL_SECONDS },
    })
  } catch { /* best-effort audit */ }

  return json({ url: signed.signedUrl, expires_in: SIGNED_TTL_SECONDS, title: doc.title }, 200)
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

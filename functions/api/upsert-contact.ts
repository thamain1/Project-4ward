// Mnemosyne — Sales Factory C5.2: create/update a contact (CF Pages Function).
// JWT → active member → upsert_contact RPC (actor = authenticated uid). contacts is read-only for members
// (migration 0015); this RPC is the only write path. A contact belongs to a client. Fails CLOSED.

import { requireMember, parseStrict, isUuid, json } from '../_lib/member-auth'

export const onRequestPost = async (context: any): Promise<Response> => {
  const parsed = await parseStrict(context, ['id', 'client_id', 'name', 'email', 'role'])
  if (!parsed.ok) return parsed.res
  const b = parsed.body
  if (b.id !== undefined && b.id !== null && !isUuid(b.id)) return json({ error: '"id" must be a uuid' }, 400)
  // client_id required on create (no id); on edit it may be omitted (PATCH keeps existing)
  if (!b.id) { if (!isUuid(b.client_id)) return json({ error: '"client_id" must be a uuid' }, 400) }
  else if (b.client_id !== undefined && b.client_id !== null && !isUuid(b.client_id)) return json({ error: '"client_id" must be a uuid' }, 400)
  // name required on create; on edit it may be omitted (PATCH keeps existing). When present it must be valid.
  if (!b.id) { if (typeof b.name !== 'string' || !b.name.trim()) return json({ error: '"name" must be a non-empty string' }, 400) }
  else if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) return json({ error: '"name" must be a non-empty string' }, 400)
  if (typeof b.name === 'string' && b.name.length > 200) return json({ error: '"name" exceeds 200 chars' }, 400)
  if (b.email !== undefined && b.email !== null && typeof b.email !== 'string') return json({ error: '"email" must be a string' }, 400)
  if (typeof b.email === 'string' && b.email.length > 200) return json({ error: '"email" exceeds 200 chars' }, 400)
  if (b.role !== undefined && b.role !== null && typeof b.role !== 'string') return json({ error: '"role" must be a string' }, 400)
  if (typeof b.role === 'string' && b.role.length > 120) return json({ error: '"role" exceeds 120 chars' }, 400)

  const auth = await requireMember(context)
  if (!auth.ok) return auth.res

  const payload: any = {}
  if (typeof b.name === 'string') payload.name = b.name.trim()
  if (b.id) payload.id = b.id
  if (b.client_id !== undefined) payload.client_id = b.client_id
  if (b.email !== undefined) payload.email = b.email
  if (b.role !== undefined) payload.role = b.role
  const { data: id, error } = await auth.admin.rpc('upsert_contact', { p_payload: payload, p_actor: auth.uid, p_audit: { op: b.id ? 'update' : 'create' } })
  if (error) {
    const msg = error.message || ''
    if (/upsert_contact:|not found|required|too long|must be/i.test(msg)) return json({ error: msg }, 400)
    return json({ error: 'write failed' }, 502)
  }
  return json({ id }, b.id ? 200 : 201)
}

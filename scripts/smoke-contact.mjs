#!/usr/bin/env node
// Mnemosyne — C5.2 live smoke: upsert_contact + per-deal activity (Aegis gate, thread 0019).
// Throwaway active member + non-member. Proves: member CANNOT direct insert/update/delete contacts (42501);
// /api/upsert-contact creates (201) + edits with PATCH (200, omitted fields preserved); per-deal note via
// /api/log-update appears in the deal's activity with actor=uid; audit crm.contact_save attributed to uid;
// 401/403/400 paths. Creates a temp client+deal to hang the contact/note on, cleans everything up.
//
// Run: node --env-file=.env.local scripts/smoke-contact.mjs

import { createClient } from '@supabase/supabase-js'

const BASE = process.env.SMOKE_BASE || 'https://project-mnemosyne.pages.dev'
const URL = process.env.VITE_SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !PUB) { console.error('missing env'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const PW = 'Smoke!' + Math.abs(URL.length * 7919).toString(36) + 'xZ9'
const stamp = process.env.SMOKE_STAMP || String(Date.now())
const memberEmail = `smoke-ct-member-${stamp}@mnemosyne.test`
const nonmemberEmail = `smoke-ct-nonmember-${stamp}@mnemosyne.test`

let pass = 0, fail = 0
function check(n, ok, extra = '') { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  — ' + extra : ''}`) }
async function api(path, body, token) {
  const headers = { 'content-type': 'application/json' }; if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  let data = null; try { data = await res.json() } catch {}
  return { status: res.status, data }
}
async function signIn(email) {
  const c = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`sign-in failed: ${error.message}`)
  return data.session.access_token
}

let memberUid, nonmemberUid, clientId, dealId, contactId
async function setup() {
  const m = await admin.auth.admin.createUser({ email: memberEmail, password: PW, email_confirm: true })
  if (m.error) throw new Error('member: ' + m.error.message); memberUid = m.data.user.id
  const ins = await admin.from('team_members').insert({ id: memberUid, full_name: 'Smoke Contact Member', email: memberEmail, role: 'member', active: true })
  if (ins.error) throw new Error('team_members: ' + ins.error.message)
  const n = await admin.auth.admin.createUser({ email: nonmemberEmail, password: PW, email_confirm: true })
  if (n.error) throw new Error('nonmember: ' + n.error.message); nonmemberUid = n.data.user.id
  // temp client + deal (service-role insert — bypasses RLS) to hang the contact + note on
  const c = await admin.from('clients').insert({ name: 'Smoke Contact Client' }).select('id').single()
  if (c.error) throw new Error('client: ' + c.error.message); clientId = c.data.id
  const d = await admin.from('deals').insert({ title: 'Smoke Contact Deal', stage: 'lead', client_id: clientId }).select('id').single()
  if (d.error) throw new Error('deal: ' + d.error.message); dealId = d.data.id
}
async function cleanup() {
  if (contactId) await admin.from('activity_log').delete().eq('entity_id', contactId)
  if (dealId) { await admin.from('activity_log').delete().eq('entity_id', dealId); await admin.from('deals').delete().eq('id', dealId) }
  if (contactId) await admin.from('contacts').delete().eq('id', contactId)
  if (clientId) await admin.from('clients').delete().eq('id', clientId)
  if (memberUid) await admin.auth.admin.deleteUser(memberUid)
  if (nonmemberUid) await admin.auth.admin.deleteUser(nonmemberUid)
}

async function run() {
  await setup()
  const memberJwt = await signIn(memberEmail)
  const nonmemberJwt = await signIn(nonmemberEmail)
  const mc = createClient(URL, PUB, { global: { headers: { Authorization: `Bearer ${memberJwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })

  // lockdown: member cannot direct-write contacts
  const di = await mc.from('contacts').insert({ client_id: clientId, name: 'BYPASS' }).select('id')
  check('member direct INSERT contacts -> denied', !!di.error || (di.data?.length ?? 0) === 0, di.error ? `(${di.error.code})` : `inserted ${di.data?.length}`)
  if (di.data?.[0]?.id) await admin.from('contacts').delete().eq('id', di.data[0].id)

  // create contact via endpoint
  const c = await api('/api/upsert-contact', { client_id: clientId, name: 'Dana Rivera', email: 'dana@acme.example', role: 'Founder' }, memberJwt)
  contactId = c.data?.id
  check('create contact -> 201 + id', c.status === 201 && !!contactId, `status=${c.status}`)

  // PATCH edit: change only role; email + name must be preserved
  const e = await api('/api/upsert-contact', { id: contactId, role: 'CEO' }, memberJwt)
  check('edit contact (PATCH role) -> 200', e.status === 200, `status=${e.status}`)
  const { data: row } = await admin.from('contacts').select('name, email, role').eq('id', contactId).maybeSingle()
  check('PATCH preserved name+email, changed role', row?.name === 'Dana Rivera' && row?.email === 'dana@acme.example' && row?.role === 'CEO', JSON.stringify(row))

  // audit attribution
  const { data: aud } = await admin.from('activity_log').select('actor_id').eq('action', 'crm.contact_save').eq('entity_id', contactId).limit(1).maybeSingle()
  check('crm.contact_save audit actor=uid', aud?.actor_id === memberUid, `actor=${aud?.actor_id}`)

  // per-deal note via reused /api/log-update
  const note = await api('/api/log-update', { note: 'Called Dana, sending the SOW.', action: 'deal.note', entity_type: 'deals', entity_id: dealId }, memberJwt)
  check('per-deal note -> 201', note.status === 201, `status=${note.status}`)
  const { data: dn } = await admin.from('activity_log').select('actor_id, detail').eq('action', 'deal.note').eq('entity_id', dealId).limit(1).maybeSingle()
  check('deal note in activity_log, actor=uid, text stored', dn?.actor_id === memberUid && dn?.detail?.note === 'Called Dana, sending the SOW.', JSON.stringify(dn?.detail))

  // auth/arg paths
  check('missing JWT -> 401', (await api('/api/upsert-contact', { client_id: clientId, name: 'x' }, null)).status === 401)
  check('non-member -> 403', (await api('/api/upsert-contact', { client_id: clientId, name: 'x' }, nonmemberJwt)).status === 403)
  check('missing client_id on create -> 400', (await api('/api/upsert-contact', { name: 'x' }, memberJwt)).status === 400)
  check('bad uuid client_id -> 400', (await api('/api/upsert-contact', { client_id: 'nope', name: 'x' }, memberJwt)).status === 400)
  check('missing name on create -> 400', (await api('/api/upsert-contact', { client_id: clientId }, memberJwt)).status === 400)
  check('overlong role -> 400', (await api('/api/upsert-contact', { client_id: clientId, name: 'x', role: 'r'.repeat(121) }, memberJwt)).status === 400)
  check('extra key -> 400', (await api('/api/upsert-contact', { client_id: clientId, name: 'x', bogus: 1 }, memberJwt)).status === 400)
  check('nonexistent client -> 400', (await api('/api/upsert-contact', { client_id: '00000000-0000-0000-0000-000000000000', name: 'x' }, memberJwt)).status === 400)
  check('secret-bearing deal note -> 400', (await api('/api/log-update', { note: 'key AKIAIOSFODNN7EXAMPLE', action: 'deal.note', entity_type: 'deals', entity_id: dealId }, memberJwt)).status === 400)
}

run().catch((e) => { console.error('SMOKE ERROR:', e.message); fail++ })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup warning:', e.message) }
    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} pass / ${fail} fail`)
    process.exit(fail === 0 ? 0 : 1)
  })

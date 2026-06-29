#!/usr/bin/env node
// Mnemosyne — Document Factory (thread 0023) Phase D live smoke for persist + download.
// REQUIRES migration 0022 applied + CF Browser Rendering env. Creates a throwaway active member + non-member,
// exercises the Aegis battery, and cleans up ALL residue (documents, document_versions, Storage objects, users).
// Run: node --env-file=.env.local scripts/smoke-save-rendered.mjs

import { createClient } from '@supabase/supabase-js'

const BASE = process.env.SMOKE_BASE || 'https://project-mnemosyne.pages.dev'
const URL = process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !PUB) { console.error('missing env'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const PW = 'Smoke!' + Math.abs(URL.length * 7919).toString(36) + 'xZ9'
const stamp = process.env.SMOKE_STAMP || String(Date.now())
const memberEmail = `smoke-save-member-${stamp}@mnemosyne.test`
const nonmemberEmail = `smoke-save-nonmember-${stamp}@mnemosyne.test`
const BUCKET = 'documents'

let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`) }

async function api(path, body, token, raw = false) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, json }
}
async function signIn(email) {
  const c = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return data.session.access_token
}

const CLEAN_MD = '{{block:logo}}\n\n# White Paper\n\n## Summary\n\nAn overview of a managed platform for the team.'
let memberUid, nonmemberUid
const createdDocIds = []

async function setup() {
  const m = await admin.auth.admin.createUser({ email: memberEmail, password: PW, email_confirm: true })
  if (m.error) throw new Error('member: ' + m.error.message)
  memberUid = m.data.user.id
  const ins = await admin.from('team_members').insert({ id: memberUid, full_name: 'Smoke Save Member', email: memberEmail, role: 'member', active: true })
  if (ins.error) throw new Error('team_members: ' + ins.error.message)
  const n = await admin.auth.admin.createUser({ email: nonmemberEmail, password: PW, email_confirm: true })
  if (n.error) throw new Error('nonmember: ' + n.error.message)
  nonmemberUid = n.data.user.id
}
async function cleanup() {
  for (const id of createdDocIds) {
    await admin.storage.from(BUCKET).remove([`rendered/${id}/v1.pdf`]).catch(() => {})
    await admin.from('document_versions').delete().eq('document_id', id).catch(() => {})
    await admin.from('documents').delete().eq('id', id).catch(() => {})
  }
  if (memberUid) await admin.auth.admin.deleteUser(memberUid)
  if (nonmemberUid) await admin.auth.admin.deleteUser(nonmemberUid)
}

async function main() {
  await setup()
  try {
    const mJwt = await signIn(memberEmail)
    const nJwt = await signIn(nonmemberEmail)
    const ok = { doc_type: 'white-paper', markdown: CLEAN_MD, audience: 'internal' }

    // auth + args
    check('save: missing JWT -> 401', (await api('/api/save-rendered-document', ok, null)).status === 401)
    check('save: non-member -> 403', (await api('/api/save-rendered-document', ok, nJwt)).status === 403)
    check('save: unknown doc_type -> 400', (await api('/api/save-rendered-document', { doc_type: 'nope', markdown: 'x' }, mJwt)).status === 400)
    check('save: unexpected field -> 400', (await api('/api/save-rendered-document', { ...ok, foo: 1 }, mJwt)).status === 400)
    check('save: bad deal_id -> 400', (await api('/api/save-rendered-document', { ...ok, deal_id: 'not-a-uuid' }, mJwt)).status === 400)

    // governance 422 — must leave zero residue
    const beforeDocs = (await admin.from('documents').select('id', { count: 'exact', head: true })).count ?? 0
    const blocked = await api('/api/save-rendered-document', { doc_type: 'mou', markdown: '# MOU\n\nWe use Supabase.' }, mJwt)
    check('save: contract+brand -> 422', blocked.status === 422)
    const afterDocs = (await admin.from('documents').select('id', { count: 'exact', head: true })).count ?? 0
    check('save: 422 left zero residue', beforeDocs === afterDocs, `before=${beforeDocs} after=${afterDocs}`)

    // valid save -> row + private PDF object + audit + v1 version
    const saved = await api('/api/save-rendered-document', ok, mJwt)
    check('save: valid -> 200 + id', saved.status === 200 && !!saved.json?.id, `status=${saved.status}`)
    const id = saved.json?.id
    if (id) {
      createdDocIds.push(id)
      const { data: row } = await admin.from('documents').select('origin, storage_path, created_by, doc_type').eq('id', id).maybeSingle()
      check('save: documents row origin=rendered + path + actor', row?.origin === 'rendered' && row?.storage_path === `rendered/${id}/v1.pdf` && row?.created_by === memberUid)
      const { data: ver } = await admin.from('document_versions').select('version_no, markdown').eq('document_id', id).maybeSingle()
      check('save: v1 snapshot written', ver?.version_no === 1 && typeof ver?.markdown === 'string')
      const { data: obj } = await admin.storage.from(BUCKET).download(`rendered/${id}/v1.pdf`)
      const head = obj ? Buffer.from(await obj.arrayBuffer()).slice(0, 5).toString('latin1') : ''
      check('save: private PDF object exists (%PDF)', head.startsWith('%PDF'))
      const { data: aud } = await admin.from('activity_log').select('action, detail').eq('entity_id', id).eq('action', 'document.render_save').maybeSingle()
      check('save: metadata-only audit (no markdown/bytes)', !!aud && !JSON.stringify(aud.detail).includes('managed platform'))

      // download: member gets a signed URL that yields a real PDF
      const dl = await api('/api/document-download', { id }, mJwt)
      check('download: member -> 200 + url', dl.status === 200 && typeof dl.json?.url === 'string')
      if (dl.json?.url) {
        const pdfRes = await fetch(dl.json.url)
        const magic = Buffer.from(await pdfRes.arrayBuffer()).slice(0, 5).toString('latin1')
        check('download: signed URL yields %PDF', magic.startsWith('%PDF'))
      }
      check('download: non-member -> 403', (await api('/api/document-download', { id }, nJwt)).status === 403)

      // direct member writes denied (RLS) — documents + document_versions + Storage
      const mClient = createClient(URL, PUB, { auth: { persistSession: false } }); await mClient.auth.setSession({ access_token: mJwt, refresh_token: 'x' }).catch(() => {})
      const mAuthed = createClient(URL, PUB, { global: { headers: { authorization: `Bearer ${mJwt}` } }, auth: { persistSession: false } })
      const dw = await mAuthed.from('documents').insert({ doc_type: 'other', title: 'hack', origin: 'rendered' })
      check('rls: member direct documents insert denied', !!dw.error)
      const vw = await mAuthed.from('document_versions').select('id').limit(1)
      check('rls: member document_versions select denied/empty', !!vw.error || (vw.data?.length ?? 0) === 0)
      const sw = await mAuthed.storage.from(BUCKET).upload(`rendered/hack/v1.pdf`, new Blob(['x']))
      check('rls: member direct Storage upload denied', !!sw.error)
    }

    // ---- POST-UPLOAD RPC-FAILURE CLEANUP (Aegis P1) ----
    // valid-UUID but nonexistent deal_id passes endpoint validation + render + upload, then the RPC raises
    // (deal not found) AFTER the object is uploaded → exercises the delete-on-failure cleanup. Prove BOTH the
    // documents table and the rendered/ Storage prefix are unchanged (no orphan row, no orphan object).
    {
      const NONEXISTENT_DEAL = '00000000-0000-0000-0000-000000000000'
      const beforeDocs = (await admin.from('documents').select('id', { count: 'exact', head: true })).count ?? 0
      const beforeObjs = ((await admin.storage.from(BUCKET).list('rendered', { limit: 1000 })).data ?? []).length
      const failed = await api('/api/save-rendered-document', { doc_type: 'white-paper', markdown: CLEAN_MD, audience: 'internal', deal_id: NONEXISTENT_DEAL }, mJwt)
      check('cleanup: nonexistent deal_id -> 502 (RPC fails after upload)', failed.status === 502, `status=${failed.status}`)
      check('cleanup: endpoint reports cleanup ok (no orphan)', failed.json?.cleanup === 'ok', `cleanup=${failed.json?.cleanup} orphan=${failed.json?.orphan}`)
      const afterDocs = (await admin.from('documents').select('id', { count: 'exact', head: true })).count ?? 0
      const afterObjs = ((await admin.storage.from(BUCKET).list('rendered', { limit: 1000 })).data ?? []).length
      check('cleanup: zero DB residue after RPC failure', beforeDocs === afterDocs, `before=${beforeDocs} after=${afterDocs}`)
      check('cleanup: zero Storage residue after RPC failure', beforeObjs === afterObjs, `before=${beforeObjs} after=${afterObjs}`)
    }

    // download: bad id 400 / missing 404
    check('download: bad id -> 400', (await api('/api/document-download', { id: 'nope' }, mJwt)).status === 400)
    check('download: missing -> 404', (await api('/api/document-download', { id: '00000000-0000-0000-0000-000000000000' }, mJwt)).status === 404)
  } finally {
    await cleanup()
  }
  console.log(`\n[smoke-save-rendered] pass=${pass} fail=${fail}`)
  if (fail) process.exitCode = 1
}
main().catch((e) => { console.error('SMOKE ERROR:', e.message); cleanup().finally(() => process.exit(1)) })

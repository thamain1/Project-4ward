#!/usr/bin/env node
// Mnemosyne — Document Factory (thread 0023) live smoke for /api/render-document.
// Creates a throwaway ACTIVE member + non-member, signs in for real JWTs, and asserts the Aegis gate battery:
// auth (401/403), strict args (400), governance policy-split (422), and a valid VALID member call returning a
// real branded PDF (content-type + %PDF magic + non-trivial size). The Browser-Rendering lockdown
// (allowRequestPattern: ["^data:"]) is enforced server-side in render-document.ts; a clean doc that renders to
// a valid PDF confirms the inline data: logo loads while no external resource is needed.
// Run: node --env-file=.env.local scripts/smoke-render-document.mjs

import { createClient } from '@supabase/supabase-js'

const BASE = process.env.SMOKE_BASE || 'https://project-mnemosyne.pages.dev'
const URL = process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !PUB) { console.error('missing env (URL / SERVICE / PUBLISHABLE)'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const PW = 'Smoke!' + Math.abs(URL.length * 7919).toString(36) + 'xZ9'
const stamp = process.env.SMOKE_STAMP || String(Date.now())
const memberEmail = `smoke-render-member-${stamp}@mnemosyne.test`
const nonmemberEmail = `smoke-render-nonmember-${stamp}@mnemosyne.test`

let pass = 0, fail = 0
function check(name, ok, extra = '') { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

// POST helper: returns { status, ct, json, bytes }. Reads bytes for PDF, json otherwise.
async function render(body, token, raw = false) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}/api/render-document`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/pdf')) { const buf = Buffer.from(await res.arrayBuffer()); return { status: res.status, ct, bytes: buf } }
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, ct, json }
}
async function signIn(email) {
  const c = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error || !data?.session?.access_token) throw new Error(`sign-in failed for ${email}: ${error?.message}`)
  return data.session.access_token
}

const CLEAN_MOU = `{{block:logo}}

# Memorandum of Understanding

This engagement is between 4ward and the Client to build a member portal on a managed database platform and a transactional email provider.

## 1. Scope
A responsive web portal: signup, booking, attendance.

{{block:signature | entity=Acme Wellness LLC | name=Dana Rivera | title=Founder}}`

let memberUid, nonmemberUid
async function setup() {
  const m = await admin.auth.admin.createUser({ email: memberEmail, password: PW, email_confirm: true })
  if (m.error) throw new Error('createUser member: ' + m.error.message)
  memberUid = m.data.user.id
  const ins = await admin.from('team_members').insert({ id: memberUid, full_name: 'Smoke Render Member', email: memberEmail, role: 'member', active: true })
  if (ins.error) throw new Error('insert team_members: ' + ins.error.message)
  const n = await admin.auth.admin.createUser({ email: nonmemberEmail, password: PW, email_confirm: true })
  if (n.error) throw new Error('createUser nonmember: ' + n.error.message)
  nonmemberUid = n.data.user.id
}
async function cleanup() {
  if (memberUid) await admin.auth.admin.deleteUser(memberUid)
  if (nonmemberUid) await admin.auth.admin.deleteUser(nonmemberUid)
}

async function main() {
  await setup()
  try {
    const memberJwt = await signIn(memberEmail)
    const nonmemberJwt = await signIn(nonmemberEmail)
    const ok = { doc_type: 'mou', markdown: CLEAN_MOU }

    // ---- auth ----
    check('missing JWT -> 401', (await render(ok, null)).status === 401)
    check('invalid JWT -> 401', (await render(ok, 'not-a-jwt')).status === 401)
    check('non-member JWT -> 403', (await render(ok, nonmemberJwt)).status === 403)

    // ---- strict args (member) ----
    check('unknown doc_type -> 400', (await render({ doc_type: 'nope', markdown: 'x' }, memberJwt)).status === 400)
    check('missing markdown -> 400', (await render({ doc_type: 'mou' }, memberJwt)).status === 400)
    check('empty markdown -> 400', (await render({ doc_type: 'mou', markdown: '   ' }, memberJwt)).status === 400)
    check('unexpected field -> 400', (await render({ doc_type: 'mou', markdown: 'x', foo: 1 }, memberJwt)).status === 400)
    check('bad audience -> 400', (await render({ doc_type: 'mou', markdown: 'x', audience: 'public' }, memberJwt)).status === 400)
    check('invalid JSON -> 400', (await render('{not json', memberJwt, true)).status === 400)

    // ---- governance policy-split (member) ----
    const brandHit = await render({ doc_type: 'mou', markdown: '# MOU\n\nWe use Supabase and Stripe.' }, memberJwt)
    check('contract + vendor brand -> 422', brandHit.status === 422 && brandHit.json?.hits?.some((h) => h.category === 'brand'))
    const secretHit = await render({ doc_type: 'mou', markdown: '# MOU\n\nkey sk_live_' + 'a'.repeat(20) }, memberJwt)
    check('contract + secret -> 422', secretHit.status === 422 && secretHit.json?.hits?.some((h) => h.category === 'secret'))
    const mktInternal = await render({ doc_type: 'capabilities-brief', audience: 'internal', markdown: '# Capabilities\n\nBuilt on Supabase + Cloudflare.' }, memberJwt)
    check('marketing-internal + brand -> 200 PDF (brand allowed)', mktInternal.status === 200 && mktInternal.ct.includes('application/pdf'))
    const mktClientBrand = await render({ doc_type: 'capabilities-brief', audience: 'client', markdown: '# Capabilities\n\nBuilt on Supabase.' }, memberJwt)
    check('marketing-client + brand -> 422 (brand blocked)', mktClientBrand.status === 422)

    // ---- valid render -> real PDF ----
    const r = await render(ok, memberJwt)
    if (r.status === 503) { check('valid member -> 200 PDF', false, '503: CF_ACCOUNT_ID / CF_BROWSER_RENDERING_TOKEN not bound yet (redeploy after setting env)'); }
    else {
      check('valid member -> 200', r.status === 200, `status=${r.status} ${r.json ? JSON.stringify(r.json).slice(0,120) : ''}`)
      check('content-type application/pdf', r.ct.includes('application/pdf'))
      check('body is a real PDF (%PDF magic)', !!r.bytes && r.bytes.slice(0, 5).toString('latin1').startsWith('%PDF'))
      check('PDF non-trivial size (>3KB)', !!r.bytes && r.bytes.length > 3000, r.bytes ? `${r.bytes.length} bytes` : 'no bytes')
    }
  } finally {
    await cleanup()
  }
  console.log(`\n[smoke-render-document] pass=${pass} fail=${fail}`)
  if (fail) process.exitCode = 1
}
main().catch((e) => { console.error('SMOKE ERROR:', e.message); cleanup().finally(() => process.exit(1)) })

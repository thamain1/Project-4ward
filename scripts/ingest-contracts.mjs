// Mnemosyne — Sales Factory C1: ingest contract .md files into documents/document_chunks.
//
// Scans the deal contracts/ dirs for *.md (the canonical source; .pdf/.html are generated from it, so we
// ignore them — and that naturally excludes third-party PDFs that have no .md). Secret-scans each file,
// derives doc_type/title, chunks, embeds (RETRIEVAL_DOCUMENT, 768, normalized), and upserts documents +
// document_chunks via the service role. Idempotent: re-ingesting a doc replaces its chunks.
//
//   node --env-file=.env.local scripts/ingest-contracts.mjs --dry-run   # scan + plan, NO keys/writes needed
//   node --env-file=.env.local scripts/ingest-contracts.mjs             # LIVE (Gemini + service-role; Jesse-go)
//
// Sources (3 deals). EMAIL_*/cover md included as doc_type 'other'. Skips .pdf/.html/.py/.png.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const SOURCES = [
  { dir: 'C:/Dev/OnTheHash/contracts', deal: 'OnTheHash' },
  { dir: 'C:/Dev/SpencerLeadGen/contracts', deal: 'Spencer' },
  { dir: 'C:/Dev/WomensFinance/contracts', deal: 'GIAV' },
]
const MODEL = 'gemini-embedding-001', DIMS = 768
const CHUNK_THRESHOLD = 8000, CHUNK_SIZE = 6000, CHUNK_OVERLAP = 500

const DRY = process.argv.slice(2).includes('--dry-run')

// secret-scan (mirrors scripts/ingest-embed.mjs). Contracts shouldn't carry keys, but scan anyway.
const SECRET_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/, /\bsbp_[A-Za-z0-9]{20,}/, /\bsb_(secret|publishable)_[A-Za-z0-9_]+/,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/, /AIza[0-9A-Za-z_\-]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{8,}/,
]
const scanSecret = (text) => { for (const re of SECRET_PATTERNS) if (re.test(text)) return `/${re.source.slice(0, 20)}…/`; return null }

function docType(file) {
  const f = file.toLowerCase()
  if (f.startsWith('mou')) return 'mou'
  if (f.startsWith('sow')) return 'sow'
  if (f.startsWith('proposal')) return 'proposal'
  if (f.startsWith('invoice')) return 'invoice'
  return 'other'
}
function chunkBody(b) {
  if (b.length <= CHUNK_THRESHOLD) return [b]
  const out = []
  for (let i = 0; i < b.length; i += CHUNK_SIZE - CHUNK_OVERLAP) out.push(b.slice(i, i + CHUNK_SIZE))
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function embed(text, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  const body = JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS })
  for (let a = 1; a <= 5; a++) {
    let res
    try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body }) }
    catch (e) { if (a < 5) { await sleep(a * 2000); continue } throw e }
    if (res.ok) {
      const v = (await res.json())?.embedding?.values
      if (!Array.isArray(v) || v.length !== DIMS || !v.every(Number.isFinite)) throw new Error(`bad embedding (len ${v?.length})`)
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return '[' + v.map((x) => x / norm).join(',') + ']'
    }
    const t = await res.text()
    if ((res.status === 429 || res.status >= 500) && a < 5) { await sleep(a * 2000); continue }
    throw new Error(`embed ${res.status}: ${t.slice(0, 120)}`)
  }
  throw new Error('embed: exhausted retries')
}

// ---- collect the .md plan ----
const plan = []
let quarantined = 0
for (const { dir, deal } of SOURCES) {
  if (!existsSync(dir)) { console.warn(`  (missing dir: ${dir})`); continue }
  for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))) {
    const raw = readFileSync(join(dir, file), 'utf8')
    const reason = scanSecret(raw)
    if (reason) { console.warn(`  QUARANTINE ${deal}/${file} (${reason})`); quarantined++; continue }
    const dt = docType(file)
    const title = `${deal} — ${basename(file, '.md').replace(/_/g, ' ')}`
    plan.push({ deal, file, doc_type: dt, title, body: raw.trim(), parts: chunkBody(raw.trim()).length })
  }
}
console.log(`[ingest-contracts] mode=${DRY ? 'DRY-RUN' : 'LIVE'}  files=${plan.length}  quarantined=${quarantined}`)
for (const p of plan) console.log(`  ${p.doc_type.padEnd(9)} ${p.title}  (${p.parts} chunk${p.parts > 1 ? 's' : ''}, ${p.body.length} chars)`)

if (DRY) { console.log('\n[dry-run] no embeds/writes. Re-run without --dry-run (after 0012 applied + Aegis/Jesse go).'); process.exit(0) }

// ---- live: embed + upsert ----
const URL = process.env.VITE_SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, GEMINI = process.env.GEMINI_API_KEY
if (!URL || !SERVICE || !GEMINI) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY')
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

let docs = 0, chunks = 0, fail = 0
for (const p of plan) {
  try {
    // upsert the documents row (idempotent on title) and get its id
    const sel = await admin.from('documents').select('id').eq('title', p.title).maybeSingle()
    let docId = sel.data?.id
    if (docId) {
      await admin.from('documents').update({ doc_type: p.doc_type, extracted_text: p.body }).eq('id', docId)
      await admin.from('document_chunks').delete().eq('document_id', docId) // replace chunks
    } else {
      const ins = await admin.from('documents').insert({ doc_type: p.doc_type, title: p.title, extracted_text: p.body }).select('id').single()
      if (ins.error) throw new Error(ins.error.message)
      docId = ins.data.id
    }
    const parts = chunkBody(p.body)
    const rows = []
    for (let i = 0; i < parts.length; i++) rows.push({ document_id: docId, chunk_index: i, content: parts[i], embedding: await embed(parts[i], GEMINI), embedding_model: MODEL })
    const ci = await admin.from('document_chunks').insert(rows)
    if (ci.error) throw new Error(ci.error.message)
    docs++; chunks += rows.length
    console.log(`  OK ${p.title} (${rows.length} chunk${rows.length > 1 ? 's' : ''})`)
  } catch (e) { console.error(`  FAIL ${p.title}: ${e.message}`); fail++ }
}
console.log(`\n[ingest-contracts] done: ${docs} docs, ${chunks} chunks, ${fail} failed`)
if (fail) process.exitCode = 1

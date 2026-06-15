// Project 4ward — Phase 1 ingestion, PERSIST phase.
// Holds ONLY the service-role key; refuses to start if the Gemini key is present (Aegis 0002 r3 #1).
// Strictly validates the artifact BEFORE constructing any Supabase client (#2); --dry-run is keyless and
// does the full validation with no client. All writes go through the hardened RPCs (start_ingestion_run,
// ingest_memory_entry, finish_ingestion_run) — no direct table writes. A failed audit write fails the run.
//
// Run:  node --env-file=.env.persist.local scripts/ingest-persist.mjs [--dry-run]

import { readFile } from 'node:fs/promises'

const ART = '.ingest/memory.jsonl'
const RUN = '.ingest/run.json'
const DRY = process.argv.slice(2).includes('--dry-run')

const KINDS = new Set(['user', 'feedback', 'project', 'reference'])
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ALLOWED_KEYS = new Set(['name', 'kind', 'title', 'body', 'links', 'source_path', 'embedding_model', 'embedding', 'chunks'])
const CHUNK_KEYS = new Set(['chunk_index', 'content', 'embedding', 'embedding_model'])

function vec768(s) {
  let a
  try { a = JSON.parse(s) } catch { return false }
  return Array.isArray(a) && a.length === 768 && a.every(Number.isFinite)
}
function validate(rec, i) {
  const where = `record ${i} (${rec?.name ?? '?'})`
  if (typeof rec !== 'object' || rec === null) throw new Error(`${where}: not an object`)
  for (const k of Object.keys(rec)) if (!ALLOWED_KEYS.has(k)) throw new Error(`${where}: unexpected key "${k}"`)
  if (!SLUG.test(rec.name ?? '')) throw new Error(`${where}: bad name`)
  if (!KINDS.has(rec.kind)) throw new Error(`${where}: bad kind "${rec.kind}"`)
  if (rec.embedding_model !== 'gemini-embedding-001') throw new Error(`${where}: bad embedding_model`)
  if (!rec.title) throw new Error(`${where}: missing title`)
  if (!rec.body) throw new Error(`${where}: missing body`)
  if (!Array.isArray(rec.links)) throw new Error(`${where}: links must be an array`)
  if (typeof rec.source_path !== 'string' || !rec.source_path.startsWith('memory/')) throw new Error(`${where}: bad source_path`)
  if (!Array.isArray(rec.chunks)) throw new Error(`${where}: chunks must be an array`)
  const hasChunks = rec.chunks.length > 0
  if (hasChunks) {
    if (rec.embedding !== null) throw new Error(`${where}: chunked entry must have null embedding`)
    rec.chunks.forEach((c, j) => {
      for (const k of Object.keys(c)) if (!CHUNK_KEYS.has(k)) throw new Error(`${where} chunk ${j}: unexpected key "${k}"`)
      if (c.chunk_index !== j) throw new Error(`${where}: non-contiguous chunk_index (expected ${j})`)
      if (!c.content) throw new Error(`${where} chunk ${j}: empty content`)
      if (c.embedding_model !== 'gemini-embedding-001') throw new Error(`${where} chunk ${j}: bad embedding_model`)
      if (!vec768(c.embedding)) throw new Error(`${where} chunk ${j}: embedding not 768-dim finite`)
    })
  } else {
    if (!vec768(rec.embedding)) throw new Error(`${where}: unchunked entry needs a 768-dim finite embedding`)
  }
}

// ---- least-privilege guard ----
if (process.env.GEMINI_API_KEY) {
  throw new Error('persist phase must NOT have GEMINI_API_KEY in its environment — run with --env-file=.env.persist.local (service role only)')
}

// ---- load + validate (keyless, before any client) ----
let lines
try { lines = (await readFile(ART, 'utf8')).split('\n').filter(Boolean) }
catch { if (DRY) { console.log(`[persist] no artifact at ${ART} — run the embed phase first. (dry-run: nothing to validate)`); process.exit(0) } else throw new Error(`artifact not found: ${ART}`) }
if (lines.length === 0) throw new Error('empty artifact')
const records = lines.map((l, i) => { try { return JSON.parse(l) } catch { throw new Error(`record ${i}: invalid JSON`) } })

let runMeta = {}
try { runMeta = JSON.parse(await readFile(RUN, 'utf8')) } catch { if (!DRY) throw new Error(`run metadata not found: ${RUN}`) }

const names = records.map((r) => r.name)
const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
if (dupes.length) throw new Error(`duplicate identities: ${dupes.join(', ')}`)
records.forEach(validate)
console.log(`[persist] validated ${records.length} records (0 errors), dryRun=${DRY}`)
if (DRY) { console.log('[persist] dry-run OK — validation passed, no writes, no Supabase client constructed.'); process.exit(0) }

// ---- live: all writes via RPC ----
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(URL, KEY, { auth: { persistSession: false } })

const { data: runId, error: eStart } = await supabase.rpc('start_ingestion_run', { p_kind: 'memory', p_embed_counts: runMeta.embed_counts ?? {} })
if (eStart) throw new Error(`start_ingestion_run failed: ${eStart.message}`)

let ok = 0, failed = 0
for (const rec of records) {
  const { error } = await supabase.rpc('ingest_memory_entry', { payload: rec })
  if (error) { console.error(`  FAIL ${rec.name}: ${error.message}`); failed++ } else ok++
}

const status = failed ? 'partial' : 'success'
const { error: eFin } = await supabase.rpc('finish_ingestion_run', { p_id: runId, p_status: status, p_counts: { persisted: ok, failed } })
if (eFin) { console.error(`audit finalize failed: ${eFin.message}`); process.exitCode = 1 } // failed audit write = failed run
console.log(`[persist] run=${runId} status=${status} ok=${ok} failed=${failed}`)
if (failed) process.exitCode = 1

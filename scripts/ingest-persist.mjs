// Mnemosyne — Phase 1 ingestion, PERSIST phase.
// Holds ONLY the service-role key; refuses to start if the Gemini key is present. Fully validates the
// artifact + run metadata (shared lib) BEFORE constructing any Supabase client; --dry-run is keyless.
// All writes go through the hardened RPCs (start/finish_ingestion_run, ingest_memory_entry). run_id is
// transport metadata (stripped before the RPC). Run status: failed when zero persist; an unexpected
// error best-effort finalizes the run as failed without masking the original error.
//
// Run:  node --env-file=.env.persist.local scripts/ingest-persist.mjs [--dry-run]

import { readFile } from 'node:fs/promises'
import { validateRunMeta, validateRecord, reconcileCounts } from './lib/ingest-validate.mjs'
import { runPersist } from './lib/ingest-run.mjs'

const ART = '.ingest/memory.jsonl'
const RUN = '.ingest/run.json'
const DRY = process.argv.slice(2).includes('--dry-run')

if (process.env.GEMINI_API_KEY) throw new Error('persist phase must NOT have GEMINI_API_KEY in its environment — run with --env-file=.env.persist.local')

// ---- load + validate (keyless, before any client) ----
let lines
try { lines = (await readFile(ART, 'utf8')).split('\n').filter(Boolean) }
catch { if (DRY) { console.log(`[persist] no artifact at ${ART} — run the embed phase first. (dry-run: nothing to validate)`); process.exit(0) } else throw new Error(`artifact not found: ${ART}`) }
if (lines.length === 0) throw new Error('empty artifact')

let runMeta
try { runMeta = JSON.parse(await readFile(RUN, 'utf8')) } catch { throw new Error(`run metadata not found/invalid: ${RUN}`) }
validateRunMeta(runMeta)

const records = lines.map((l, i) => { try { return JSON.parse(l) } catch { throw new Error(`record ${i}: invalid JSON`) } })
const names = records.map((r) => r.name)
const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
if (dupes.length) throw new Error(`duplicate identities: ${dupes.join(', ')}`)
records.forEach((r, i) => validateRecord(r, i, runMeta.run_id))
reconcileCounts(records, runMeta.embed_counts)
console.log(`[persist] validated ${records.length} records + run metadata (0 errors), dryRun=${DRY}`)
if (DRY) { console.log('[persist] dry-run OK — validation passed; no writes, no Supabase client constructed.'); process.exit(0) }

// ---- live: all writes via the injectable runPersist orchestration ----
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(URL, KEY, { auth: { persistSession: false } })
const rpc = (fn, args) => supabase.rpc(fn, args)

const res = await runPersist({ records, runMeta, rpc })
if (!res.finalized) {
  console.error(`[persist] run=${res.dbRunId} FINALIZE FAILED: ${res.finalizeError} (NOT recorded as ${res.status})`)
  process.exitCode = 1
} else {
  console.log(`[persist] run=${res.dbRunId} status=${res.status} ok=${res.ok} failed=${res.failed}`)
  if (res.status !== 'success') process.exitCode = 1
}

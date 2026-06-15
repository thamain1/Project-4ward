// Project 4ward — Phase 1 ingestion, EMBED phase (data-plane; DATABASE-BLIND).
// Holds ONLY the Gemini key; refuses to start if the service-role key is present. Scans for secrets +
// quarantines, parses + chunks, embeds via gemini-embedding-001 @ 768 (x-goog-api-key header, NORMALIZED),
// and writes a run-bound artifact:
//   .ingest/memory.jsonl  — one record/line: {run_id, ...the 9 ingest_memory_entry fields}
//   .ingest/run.json      — {run_id, kind, embed_counts:{accepted,quarantined,skipped,failed,embedded_vectors,chunk_rows}}
//
// Run:  node --env-file=.env.embed.local scripts/ingest-embed.mjs [--limit N] [--dir <path>]
//   --dry-run needs NO keys (scan/parse/chunk plan only; writes nothing).

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify, MODEL } from './lib/ingest-validate.mjs'

const DIMS = 768
const ALLOWED_KINDS = new Set(['user', 'feedback', 'project', 'reference'])
const CHUNK_THRESHOLD = 8000, CHUNK_SIZE = 6000, CHUNK_OVERLAP = 500
const OUT_DIR = '.ingest'

const SECRET_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/, /\bsbp_[A-Za-z0-9]{20,}/, /\bsb_(secret|publishable)_[A-Za-z0-9_]+/,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/, /AIza[0-9A-Za-z_\-]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /\b(api[_-]?key|secret|password|passwd|service_role|access_token|bearer)\b\s*[:=]\s*['"]?\S{8,}/i,
]
const DENY_FILENAME = /(secret|api[-_]?key|\bkeys?\b|cred|token|password)/i
function scanSecret(name, text) {
  if (DENY_FILENAME.test(name)) return 'filename matches secret pattern'
  for (const re of SECRET_PATTERNS) if (re.test(text)) return `content matches /${re.source.slice(0, 22)}…/`
  return null
}
function parseFrontmatter(raw) {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return null
  const [, fm, body] = m
  return {
    description: fm.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
    type: fm.match(/^\s*type:\s*([a-z_]+)\s*$/m)?.[1]?.trim(),
    body: body.trim(),
  }
}
function chunkBody(body) {
  if (body.length <= CHUNK_THRESHOLD) return [body]
  const out = []
  for (let i = 0; i < body.length; i += CHUNK_SIZE - CHUNK_OVERLAP) out.push(body.slice(i, i + CHUNK_SIZE))
  return out
}
const extractLinks = (b) => [...new Set([...b.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()))]

// ---- args / guards ----
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
let LIMIT = Infinity
if (args.includes('--limit')) {
  const n = Number(args[args.indexOf('--limit') + 1])
  if (!Number.isInteger(n) || n <= 0) throw new Error('--limit must be a positive integer')
  LIMIT = n
}
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1]
  : process.env.MEMORY_DIR || 'C:\\Users\\ThaMain1\\.claude\\projects\\c--Dev\\memory'
if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('embed phase must NOT have SUPABASE_SERVICE_ROLE_KEY in its environment — run with --env-file=.env.embed.local')
const KEY = process.env.GEMINI_API_KEY
if (!DRY && !KEY) throw new Error('Missing GEMINI_API_KEY (or use --dry-run)')
if (!(await stat(DIR).then((s) => s.isDirectory()).catch(() => false))) throw new Error(`--dir not found: ${DIR}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function embed(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  const body = JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS })
  const MAX = 5
  for (let attempt = 1; attempt <= MAX; attempt++) {
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body })
    } catch (e) { // network error — transient
      if (attempt < MAX) { await sleep(attempt * 2000); continue }
      throw e
    }
    if (res.ok) {
      const v = (await res.json())?.embedding?.values
      if (!Array.isArray(v) || v.length !== DIMS || !v.every(Number.isFinite)) throw new Error(`bad embedding (len ${v?.length})`)
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return v.map((x) => x / norm)
    }
    const txt = await res.text()
    // retry transient overload/rate-limit (429/5xx) with backoff; fail fast on real (4xx) errors
    if ((res.status === 429 || res.status >= 500) && attempt < MAX) { await sleep(attempt * 2000); continue }
    throw new Error(`embed ${res.status}: ${txt}`)
  }
  throw new Error('embed: exhausted retries')
}
const vecLit = (v) => `[${v.join(',')}]`

// ---- main ----
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f.toUpperCase() !== 'MEMORY.MD').slice(0, LIMIT)
console.log(`[embed] run=${runId} dir=${DIR} files=${files.length} dryRun=${DRY}`)
let quarantined = 0, skipped = 0, failed = 0, embeddedVectors = 0, chunkRows = 0
const records = []

for (const file of files) {
  try {
    const raw = await readFile(join(DIR, file), 'utf8')
    const reason = scanSecret(file, raw)
    if (reason) { console.warn(`  QUARANTINE ${file} (${reason})`); quarantined++; continue }
    const fm = parseFrontmatter(raw)
    if (!fm || !ALLOWED_KINDS.has(fm.type)) { console.warn(`  SKIP ${file} (no/invalid frontmatter type — manual classification)`); skipped++; continue }

    const name = slugify(file)
    const title = fm.description || name
    const parts = chunkBody(fm.body)
    const rec = {
      run_id: runId, name, kind: fm.type, title, body: fm.body, links: extractLinks(fm.body),
      source_path: `memory/${file}`, embedding_model: MODEL, embedding: null, chunks: [],
    }
    if (DRY) { console.log(`  DRY ${file} -> ${name} kind=${fm.type} parts=${parts.length} bodyLen=${fm.body.length}`); embeddedVectors += parts.length; if (parts.length > 1) chunkRows += parts.length; records.push(rec); continue }

    if (parts.length === 1) {
      rec.embedding = vecLit(await embed(`${title}\n\n${parts[0]}`)); embeddedVectors += 1
    } else {
      for (let i = 0; i < parts.length; i++) rec.chunks.push({ chunk_index: i, content: parts[i], embedding: vecLit(await embed(parts[i])), embedding_model: MODEL })
      embeddedVectors += parts.length; chunkRows += parts.length
    }
    records.push(rec)
    console.log(`  OK ${file} -> ${name} (${parts.length} part(s))`)
  } catch (e) { console.error(`  FAIL ${file}: ${e.message}`); failed++ }
}

const embed_counts = { accepted: records.length, quarantined, skipped, failed, embedded_vectors: embeddedVectors, chunk_rows: chunkRows }
if (!DRY) {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'memory.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'))
  await writeFile(join(OUT_DIR, 'run.json'), JSON.stringify({ run_id: runId, kind: 'memory', embed_counts }, null, 2))
  console.log(`[embed] wrote ${records.length} records + run.json -> ${OUT_DIR}/`)
}
console.log(`[embed] done run=${runId} ${JSON.stringify(embed_counts)}`)
if (failed) process.exitCode = 1

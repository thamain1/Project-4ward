// Project 4ward — Phase 1 ingestion, EMBED phase (data-plane; DATABASE-BLIND).
// Holds ONLY the Gemini key. Refuses to start if the service-role key is in its environment (Aegis
// 0002 round-3 #1). Scans for secrets + quarantines, parses + chunks, embeds via gemini-embedding-001
// @ 768 (x-goog-api-key header, normalized), and writes a validated artifact for the persist phase:
//   .ingest/memory.jsonl  — one clean RPC payload per line (exactly the fields ingest_memory_entry accepts)
//   .ingest/run.json      — { run_id, kind, embed_counts } (the embed phase is DB-blind; persist records the run)
//
// Run:  node --env-file=.env.embed.local scripts/ingest-embed.mjs [--limit N] [--dir <path>]
//   --dry-run needs NO keys (scan/parse/chunk plan only; writes nothing).

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MODEL = 'gemini-embedding-001'
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
const slugify = (f) => f.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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

// Least-privilege guard: the embed phase must never co-hold the service-role key.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('embed phase must NOT have SUPABASE_SERVICE_ROLE_KEY in its environment — run with --env-file=.env.embed.local (Gemini only)')
}
const KEY = process.env.GEMINI_API_KEY
if (!DRY && !KEY) throw new Error('Missing GEMINI_API_KEY (or use --dry-run)')
if (!(await stat(DIR).then((s) => s.isDirectory()).catch(() => false))) throw new Error(`--dir not found: ${DIR}`)

async function embed(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS }),
  })
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`)
  const v = (await res.json())?.embedding?.values
  if (!Array.isArray(v) || v.length !== DIMS || !v.every(Number.isFinite)) throw new Error(`bad embedding (len ${v?.length})`)
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}
const vecLit = (v) => `[${v.join(',')}]`

// ---- main ----
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f.toUpperCase() !== 'MEMORY.MD').slice(0, LIMIT)
console.log(`[embed] run=${runId} dir=${DIR} files=${files.length} dryRun=${DRY}`)
let embedded = 0, quarantined = 0, skipped = 0, chunksTotal = 0, failed = 0
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
    // record == exactly the ingest_memory_entry RPC payload (no extra keys)
    const rec = {
      name, kind: fm.type, title, body: fm.body, links: extractLinks(fm.body),
      source_path: `memory/${file}`, embedding_model: MODEL, embedding: null, chunks: [],
    }
    if (DRY) { console.log(`  DRY ${file} -> ${name} kind=${fm.type} chunks=${parts.length} bodyLen=${fm.body.length}`); embedded++; chunksTotal += parts.length; continue }

    if (parts.length === 1) {
      rec.embedding = vecLit(await embed(`${title}\n\n${parts[0]}`))
    } else {
      for (let i = 0; i < parts.length; i++) rec.chunks.push({ chunk_index: i, content: parts[i], embedding: vecLit(await embed(parts[i])), embedding_model: MODEL })
    }
    records.push(rec); embedded++; chunksTotal += parts.length
    console.log(`  OK ${file} -> ${name} (${parts.length} chunk(s))`)
  } catch (e) { console.error(`  FAIL ${file}: ${e.message}`); failed++ }
}

if (!DRY) {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'memory.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'))
  await writeFile(join(OUT_DIR, 'run.json'), JSON.stringify({ run_id: runId, kind: 'memory', embed_counts: { embedded, quarantined, skipped, failed, chunks: chunksTotal } }, null, 2))
  console.log(`[embed] wrote ${records.length} records + run.json -> ${OUT_DIR}/`)
}
console.log(`[embed] done run=${runId} embedded=${embedded} chunks=${chunksTotal} quarantined=${quarantined} skipped=${skipped} failed=${failed}`)
if (failed) process.exitCode = 1

// Mnemosyne — apply Helios's tag-refinement deltas (thread 0014) as a MERGE.
// Parses docs/helios/tag-refinement.md pipe tables -> per-entry {adds, removes} -> merges into live tags:
//   new = (current ∪ adds) \ removes   (idempotent; preserves untouched baseline tags like project:/repo:)
// Dedupes entries that appear in multiple sections (unions their deltas).
//
//   node --env-file=.env.local scripts/apply-tag-refinement.mjs --dry-run   # show plan, no writes
//   node --env-file=.env.local scripts/apply-tag-refinement.mjs             # APPLY (service-role)

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
const DRY = process.argv.slice(2).includes('--dry-run')
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

const TAG_RE = /^[a-z0-9]+(?:[:-][a-z0-9-]+)*$/  // project:slug | repo:... | topic:x | reusable | code-snippet | applies-to:slug
function parseTags(cell) {
  // cell like "`topic:x`, `applies-to:y`" or empty
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean)
}

const md = readFileSync('docs/helios/tag-refinement.md', 'utf8')
const deltas = new Map() // name -> {adds:Set, removes:Set}
for (const line of md.split('\n')) {
  const m = line.match(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/)
  if (!m) continue
  const name = m[1].trim()
  if (name === 'Entry Name') continue
  const adds = parseTags(m[4]) // col 4 = +Adds
  const removes = parseTags(m[5]) // col 5 = -Removes
  if (!deltas.has(name)) deltas.set(name, { adds: new Set(), removes: new Set() })
  const d = deltas.get(name)
  adds.forEach((t) => d.adds.add(t))
  removes.forEach((t) => d.removes.add(t))
}

// validate tag formats
let bad = []
for (const [name, d] of deltas) for (const t of [...d.adds, ...d.removes]) if (!TAG_RE.test(t)) bad.push(`${name}: ${t}`)
if (bad.length) { console.error('BAD TAG FORMAT:\n  ' + bad.join('\n  ')); process.exit(1) }

console.log(`[apply-tags] parsed ${deltas.size} unique entries from proposal (dups unioned)`)

const names = [...deltas.keys()]
const { data: rows, error } = await admin.from('memory_entries').select('name, tags').in('name', names)
if (error) throw new Error(error.message)
const cur = new Map(rows.map((r) => [r.name, r.tags || []]))

const missing = names.filter((n) => !cur.has(n))
if (missing.length) console.warn(`WARN: ${missing.length} proposal names not found in DB: ${missing.join(', ')}`)

const plan = []
for (const [name, d] of deltas) {
  if (!cur.has(name)) continue
  const before = cur.get(name)
  const set = new Set(before)
  d.adds.forEach((t) => set.add(t))
  d.removes.forEach((t) => set.delete(t))
  const after = [...set].sort()
  if (JSON.stringify(after) !== JSON.stringify([...before].sort())) plan.push({ name, before: [...before].sort(), after })
}

console.log(`[apply-tags] ${plan.length} entries change (of ${deltas.size}); ${deltas.size - plan.length} already match`)
for (const p of plan.slice(0, DRY ? 999 : 0)) {
  const added = p.after.filter((t) => !p.before.includes(t))
  const removed = p.before.filter((t) => !p.after.includes(t))
  console.log(`  ${p.name}`)
  if (added.length) console.log(`    + ${added.join(', ')}`)
  if (removed.length) console.log(`    - ${removed.join(', ')}`)
}

if (DRY) { console.log('\n[dry-run] no writes. Re-run without --dry-run to apply the merge.'); process.exit(0) }

let ok = 0, fail = 0
for (const p of plan) {
  const { error: ue } = await admin.from('memory_entries').update({ tags: p.after }).eq('name', p.name)
  if (ue) { console.error(`  FAIL ${p.name}: ${ue.message}`); fail++ } else ok++
}
console.log(`\n[apply-tags] done: ${ok} updated, ${fail} failed`)
if (fail) process.exitCode = 1

// Mnemosyne — Unit B+.2: backfill memory_entries.tags (deterministic).
// Assigns: project:<slug> (exact, via alias map) | repo:<name> (authoritative project->repo map) |
// reusable / code-snippet (reference building blocks). Cross-cutting feedback/reference get topic:<token>.
//
// Run:
//   node --env-file=.env.local scripts/backfill-tags.mjs --dry-run   # compute + print distribution, no writes
//   node --env-file=.env.local scripts/backfill-tags.mjs             # APPLY (service-role; Aegis+Jesse-gated)
//
// Requires migration 0011 applied (tags column). Idempotent: recomputes + overwrites tags for all rows.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
const DRY = process.argv.slice(2).includes('--dry-run')
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

const PREFIXES = [/^project-/, /^session-handoff-/, /^feedback-/, /^reference-/]
// project-token aliases (accurate; B+.2 baseline). Helios refines nuanced reference/feedback topics later.
const ALIAS = {
  oth: 'onthehash', io: 'intellioptics', p2p: 'p2pnow',
  '4ward': 'mnemosyne', '4wardmotion': 'mnemosyne', just: 'just-as-iam',
  isb: 'intelliservice', mes: 'intelliservice', sb: 'intelliservice',
}

// project slug -> repo label (authoritative, from MEMORY.md "All Repositories"). Only confident mappings;
// a missing entry simply yields no repo: tag (card shows no repo badge — honest).
const REPO = {
  onthehash: 'thamain1/OnTheHash',
  perks: 'thamain1/The-Perks-and-Play',
  mnemosyne: 'thamain1/Project-Mnemosyne',
  mentorapp: 'thamain1/iron-sharpens-iron',
  p2pnow: 'thamain1/iron-sharpens-iron',
  'just-as-iam': 'thamain1/Just-As-I-Am',
  allsigns: 'AllSignsSite',
  intellitax: 'C:/Dev/intellitax',
  impacttracker: 'C:/Dev/ImpactTracker',
  intellioptics: 'C:/Dev/intellioptics_2.5',
  mavenpark: 'C:/Dev/MavenPark',
  pallets: 'thamain1/Pallet-Lead-Agents',
}

// reference/feedback whose name signals a reusable building block.
const REUSABLE_RE = /(pattern|helper|runbook|template|gate|gamification|messaging|appshell|geofencing)/

function firstToken(name) {
  let s = name.toLowerCase()
  for (const re of PREFIXES) s = s.replace(re, '')
  const t = s.split('-')[0] || 'other'
  return ALIAS[t] ?? t
}

function tagsFor(row) {
  const tags = new Set()
  const tok = firstToken(row.name)
  if (row.kind === 'project') {
    tags.add(`project:${tok}`)
    if (REPO[tok]) tags.add(`repo:${REPO[tok]}`)
  } else {
    // feedback/reference/user: topic grouping; mark reusable building blocks
    tags.add(`topic:${tok}`)
    if (row.kind === 'reference') {
      tags.add('reusable')
      if (REUSABLE_RE.test(row.name)) tags.add('code-snippet')
    }
  }
  return [...tags].sort()
}

const { data: rows, error } = await admin.from('memory_entries').select('name, kind').order('name')
if (error) throw new Error(error.message)

const plan = rows.map((r) => ({ name: r.name, kind: r.kind, tags: tagsFor(r) }))

// distribution report
const dist = {}
for (const p of plan) for (const t of p.tags) dist[t] = (dist[t] || 0) + 1
console.log(`[backfill-tags] mode=${DRY ? 'DRY-RUN' : 'APPLY'}  entries=${plan.length}`)
console.log('tag distribution:')
for (const [t, c] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${t}`)

if (DRY) {
  console.log('\nsample (first 12):')
  for (const p of plan.slice(0, 12)) console.log(`  ${p.name}  ->  ${p.tags.join(', ')}`)
  console.log('\n[dry-run] no writes. Re-run without --dry-run (after 0011 applied + Aegis/Jesse go) to apply.')
  process.exit(0)
}

let ok = 0, fail = 0
for (const p of plan) {
  const { error: ue } = await admin.from('memory_entries').update({ tags: p.tags }).eq('name', p.name)
  if (ue) { console.error(`  FAIL ${p.name}: ${ue.message}`); fail++ } else ok++
}
console.log(`\n[backfill-tags] done: ${ok} updated, ${fail} failed`)
if (fail) process.exitCode = 1

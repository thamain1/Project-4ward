#!/usr/bin/env node
// One-time: seal secrets in existing credential-bearing memory files per the Sealed Credential
// standard (TOKEN-GOVERNANCE §19). Adds <!-- CREDENTIALS-FILE --> + wraps each secret value in
// {{SECRET ...}}value{{/SECRET}} IN PLACE. Values are PRESERVED (markup only). Idempotent: never
// double-seals. Prints masked summary only — no secret value is ever printed.
//   node scripts/seal-existing-credentials.mjs            # dry-run (shows what it WOULD do)
//   node scripts/seal-existing-credentials.mjs --apply    # writes the files

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const MEM = 'C:/Users/ThaMain1/.claude/projects/c--Dev/memory'
const APPLY = process.argv.includes('--apply')
const MARKER = '<!-- CREDENTIALS-FILE -->'
const mask = (s) => (s.length > 10 ? s.slice(0, 4) + '…' + s.slice(-2) + `[${s.length}c]` : '***')
const sealWrap = (val, meta) => `{{SECRET ${meta}}}${val}{{/SECRET}}`

// table-row rule: seal the FIRST unsealed value whose row label matches, scanning in order.
// Handles both `backtick` values AND bare table cells (e.g. `| Password | Sultanofswing1 |`).
function sealTableRow(text, labelRe, meta, log) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue
    if (lines[i].includes('{{SECRET')) continue                  // already sealed
    const bt = lines[i].match(/`([^`]+)`/)
    if (bt) {                                                    // backtick value
      lines[i] = lines[i].replace('`' + bt[1] + '`', '`' + sealWrap(bt[1], meta) + '`')
      log.push(`  sealed [${meta}] value=${mask(bt[1])}  (label ${labelRe.source.slice(0, 18)})`)
      return lines.join('\n')
    }
    // bare markdown table cell: | label | value |  -> wrap the value cell's content
    const cells = lines[i].split('|')
    const li = cells.findIndex((c) => labelRe.test(c))
    if (li >= 0 && cells[li + 1] !== undefined) {
      const raw = cells[li + 1]
      const val = raw.trim()
      if (val && val !== '-----') {
        cells[li + 1] = raw.replace(val, sealWrap(val, meta))
        lines[i] = cells.join('|')
        log.push(`  sealed [${meta}] value=${mask(val)}  (bare cell, label ${labelRe.source.slice(0, 18)})`)
        return lines.join('\n')
      }
    }
  }
  log.push(`  (no unsealed row for ${labelRe.source.slice(0, 18)})`)
  return text
}

// pattern rule: seal every unsealed occurrence of a token pattern
function sealPattern(text, tokenRe, meta, log) {
  const g = new RegExp(tokenRe.source, 'g')
  let count = 0
  const out = text.replace(g, (tok, ...a) => {
    const idx = a[a.length - 2]
    const pre = text.slice(Math.max(0, idx - 300), idx)            // already inside an open seal?
    if (pre.lastIndexOf('{{SECRET') > pre.lastIndexOf('{{/SECRET}}')) return tok
    count++
    return sealWrap(tok, meta)
  })
  if (count) log.push(`  sealed ${count}× [${meta}] token=${mask((text.match(tokenRe) || [''])[0])}`)
  else log.push(`  (no unsealed token for /${tokenRe.source.slice(0, 16)}/)`)
  return out
}

const JOBS = [
  { file: 'stripe-keys.md', marker: true, steps: [
    (t, l) => sealTableRow(t, /Secret \(live\)/, 'service=stripe env=live sensitivity=team', l),
    (t, l) => sealTableRow(t, /Secret \(test\)/, 'service=stripe env=test sensitivity=team', l),
    (t, l) => sealTableRow(t, /Signing Secret/, 'service=stripe-webhook env=live sensitivity=team', l),
    (t, l) => sealTableRow(t, /API Key/,        'service=sendgrid sensitivity=team', l),
    (t, l) => sealTableRow(t, /Password/,        'service=fedex sensitivity=restricted', l),   // 1st Password row = FedEx
    (t, l) => sealTableRow(t, /Password/,        'service=usps sensitivity=restricted', l),    // 2nd = USPS
  ]},
  { file: 'MEMORY.md', marker: false, steps: [
    (t, l) => sealPattern(t, /sbp_[A-Za-z0-9]{20,}/, 'service=supabase-mgmt env=prod sensitivity=restricted', l),
  ]},
  { file: 'reference_mes_customer_documents_debug.md', marker: false, steps: [
    (t, l) => sealPattern(t, /sbp_[A-Za-z0-9]{20,}/, 'service=supabase-mgmt env=prod sensitivity=restricted', l),
  ]},
  { file: 'kingdom-shepherd-os.md', marker: false, steps: [
    (t, l) => sealPattern(t, /(?<=password:\s{0,2})[^\s)|]{6,}/i, 'service=ksos-demo sensitivity=restricted', l),
  ]},
  { file: 'session_handoff_oth_phase4.md', marker: false, steps: [
    (t, l) => sealPattern(t, /postgresql:\/\/[^\s`'")|]+/, 'service=oth-database env=prod sensitivity=restricted', l),
  ]},
  { file: 'intellioptics-2.5.md', marker: false, steps: [
    (t, l) => sealPattern(t, /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, 'service=sendgrid scope=intellioptics sensitivity=team', l),
  ]},
  { file: 'intellioptics.md', marker: false, steps: [
    (t, l) => sealTableRow(t, /Pooler DSN/, 'service=intellioptics-db env=pooler sensitivity=restricted', l),
    (t, l) => sealTableRow(t, /Direct DSN/, 'service=intellioptics-db env=direct sensitivity=restricted', l),
  ]},
  { file: 'project_oth_replit_exit.md', marker: false, steps: [
    (t, l) => sealPattern(t, /postgresql:\/\/[^\s`'")|]+/, 'service=oth-neon env=prod sensitivity=restricted', l),
  ]},
  { file: 'intellisign.md', marker: false, steps: [
    (t, l) => sealPattern(t, /(?<=Initial password:\s{0,2})[^\s*`]{4,}/, 'service=intellisign-admin scope=initial sensitivity=restricted', l),
  ]},
]

console.log(APPLY ? '=== SEALING (apply) ===' : '=== DRY RUN (no writes) — pass --apply to write ===')
for (const job of JOBS) {
  const path = `${MEM}/${job.file}`
  if (!existsSync(path)) { console.log(`\n${job.file}: NOT FOUND`); continue }
  let text = readFileSync(path, 'utf8')
  const before = text
  const log = []
  if (job.marker && !text.includes(MARKER)) text = MARKER + '\n' + text
  for (const step of job.steps) text = step(text, log)
  console.log(`\n${job.file}:`)
  log.forEach((l) => console.log(l))
  console.log(`  marker: ${job.marker ? (text.startsWith(MARKER) ? 'present' : 'MISSING') : 'n/a (seal-only)'} | changed: ${text !== before}`)
  if (APPLY && text !== before) { writeFileSync(path, text, 'utf8'); console.log('  -> written') }
}
console.log('\nNOTE: kingdom-shepherd-os.md / intellisign.md / session_handoff_oth_phase4.md NOT touched (shown separately for your decision).')

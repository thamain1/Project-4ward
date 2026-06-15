// Mnemosyne — adversarial, KEYLESS validation tests for the ingestion pipeline.
// Exercises the exact shared logic the persist phase runs (scripts/lib/ingest-validate.mjs). No DB, no
// keys. Run: node scripts/test-ingest-validation.mjs   (Aegis 0002 round-3-impl #5)

import { validateRunMeta, validateRecord, reconcileCounts, decideStatus, MAX_COUNT } from './lib/ingest-validate.mjs'

const RUN = 'r1'
const MODEL = 'gemini-embedding-001'
const unit = '[' + Array(768).fill(1 / Math.sqrt(768)).join(',') + ']'  // L2 norm == 1
const base = () => ({ run_id: RUN, name: 'foo-bar', kind: 'reference', title: 't', body: 'b', links: ['x'], source_path: 'memory/foo_bar.md', embedding_model: MODEL, embedding: unit, chunks: [] })
const meta = () => ({ run_id: RUN, kind: 'memory', embed_counts: { accepted: 1, quarantined: 0, skipped: 0, failed: 0, embedded_vectors: 1, chunk_rows: 0 } })

let pass = 0, fail = 0
const ok = (l) => { console.log(`  ok    ${l}`); pass++ }
const bad = (l, m) => { console.error(`  FAIL  ${l}${m ? ' — ' + m : ''}`); fail++ }
const throws = (l, fn) => { try { fn(); bad(l, 'expected rejection, got none') } catch { ok(l + ' (rejected)') } }
const accepts = (l, fn) => { try { fn(); ok(l + ' (accepted)') } catch (e) { bad(l, e.message) } }
const eq = (l, a, b) => (a === b ? ok(l) : bad(l, `${a} !== ${b}`))

console.log('[test] adversarial keyless validation')
accepts('valid record', () => validateRecord(base(), 0, RUN))
accepts('valid run meta', () => validateRunMeta(meta()))
accepts('valid chunked record', () => validateRecord({ ...base(), embedding: null, chunks: [{ chunk_index: 0, content: 'c', embedding: unit, embedding_model: MODEL }] }, 0, RUN))

throws('run_id mismatch', () => validateRecord({ ...base(), run_id: 'other' }, 0, RUN))
throws('unexpected top-level key', () => validateRecord({ ...base(), foo: 1 }, 0, RUN))
throws('bad kind', () => validateRecord({ ...base(), kind: 'nope' }, 0, RUN))
throws('bad embedding_model', () => validateRecord({ ...base(), embedding_model: 'x' }, 0, RUN))
throws('title is object', () => validateRecord({ ...base(), title: { bad: true } }, 0, RUN))
throws('title is number', () => validateRecord({ ...base(), title: 42 }, 0, RUN))
throws('title empty string', () => validateRecord({ ...base(), title: '' }, 0, RUN))
throws('title missing', () => { const r = base(); delete r.title; validateRecord(r, 0, RUN) })
throws('body is array', () => validateRecord({ ...base(), body: [1] }, 0, RUN))
throws('body is boolean', () => validateRecord({ ...base(), body: true }, 0, RUN))
throws('body is JSON null', () => validateRecord({ ...base(), body: null }, 0, RUN))
throws('chunk content non-string', () => validateRecord({ ...base(), embedding: null, chunks: [{ chunk_index: 0, content: 42, embedding: unit, embedding_model: MODEL }] }, 0, RUN))
throws('non-unit vector', () => validateRecord({ ...base(), embedding: '[' + Array(768).fill(0.5).join(',') + ']' }, 0, RUN))
throws('zero vector', () => validateRecord({ ...base(), embedding: '[' + Array(768).fill(0).join(',') + ']' }, 0, RUN))
throws('wrong-length vector', () => validateRecord({ ...base(), embedding: '[0.1,0.2]' }, 0, RUN))
throws('traversal path', () => validateRecord({ ...base(), source_path: 'memory/../../x.md', name: 'x' }, 0, RUN))
throws('path slug != name', () => validateRecord({ ...base(), source_path: 'memory/other.md' }, 0, RUN))
throws('bad link element', () => validateRecord({ ...base(), links: [1] }, 0, RUN))
throws('missing chunks key', () => { const r = base(); delete r.chunks; validateRecord(r, 0, RUN) })
throws('non-array chunks', () => validateRecord({ ...base(), chunks: {} }, 0, RUN))
throws('unexpected chunk key', () => validateRecord({ ...base(), embedding: null, chunks: [{ chunk_index: 0, content: 'c', embedding: unit, embedding_model: MODEL, foo: 1 }] }, 0, RUN))
throws('non-contiguous chunk_index', () => validateRecord({ ...base(), embedding: null, chunks: [{ chunk_index: 1, content: 'c', embedding: unit, embedding_model: MODEL }] }, 0, RUN))

throws('run meta unexpected key', () => validateRunMeta({ ...meta(), foo: 1 }))
throws('run meta bad kind', () => validateRunMeta({ ...meta(), kind: 'x' }))
throws('run meta bad count', () => { const m = meta(); m.embed_counts.accepted = -1; validateRunMeta(m) })
throws('run meta unexpected embed_counts key', () => { const m = meta(); m.embed_counts.extra = 1; validateRunMeta(m) })
throws('run meta fractional count', () => { const m = meta(); m.embed_counts.accepted = 1.5; validateRunMeta(m) })
accepts('run meta count == MAX_COUNT', () => { const m = meta(); m.embed_counts.accepted = MAX_COUNT; validateRunMeta(m) })
throws('run meta count > MAX_COUNT', () => { const m = meta(); m.embed_counts.accepted = MAX_COUNT + 1; validateRunMeta(m) })
throws('run meta unsafe 1e100 count', () => { const m = meta(); m.embed_counts.accepted = 1e100; validateRunMeta(m) })
throws('chunk_index fractional', () => validateRecord({ ...base(), embedding: null, chunks: [{ chunk_index: 0.5, content: 'c', embedding: unit, embedding_model: MODEL }] }, 0, RUN))

throws('reconcile bad accepted', () => reconcileCounts([base()], { ...meta().embed_counts, accepted: 2 }))
throws('reconcile bad chunk_rows', () => reconcileCounts([base()], { ...meta().embed_counts, chunk_rows: 5 }))
accepts('reconcile valid (1 unchunked)', () => reconcileCounts([base()], meta().embed_counts))
accepts('reconcile valid (chunked, 2 rows)', () => reconcileCounts(
  [{ ...base(), embedding: null, chunks: [{ chunk_index: 0, content: 'a', embedding: unit, embedding_model: MODEL }, { chunk_index: 1, content: 'b', embedding: unit, embedding_model: MODEL }] }],
  { accepted: 1, quarantined: 0, skipped: 0, failed: 0, embedded_vectors: 2, chunk_rows: 2 }))

eq('status zero -> failed', decideStatus(0, 5), 'failed')
eq('status partial', decideStatus(3, 5), 'partial')
eq('status success', decideStatus(5, 5), 'success')
eq('status embed-failure -> partial', decideStatus(5, 5, 1), 'partial')
eq('status zero+embed-failure -> failed', decideStatus(0, 5, 2), 'failed')

console.log(`[test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

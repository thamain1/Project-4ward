// Mnemosyne — KEYLESS orchestration tests for runPersist (Aegis 0002 round-4/5/6).
// Mock rpc records call order + full payloads; tests assert EXACT deep-equality of every RPC call across
// success and failure paths. Run: node scripts/test-ingest-orchestration.mjs

import { runPersist } from './lib/ingest-run.mjs'
import { stripRunId } from './lib/ingest-validate.mjs'

const RUN = 'r1'
const MODEL = 'gemini-embedding-001'
const rec = (name) => ({ run_id: RUN, name, kind: 'reference', title: 't', body: 'b', links: [], source_path: `memory/${name}.md`, embedding_model: MODEL, embedding: '[]', chunks: [] })
const meta = (failed = 0) => ({ run_id: RUN, kind: 'memory', embed_counts: { accepted: 2, quarantined: 0, skipped: 0, failed, embedded_vectors: 2, chunk_rows: 0 } })
const records2 = [rec('a'), rec('b')]
const quiet = { error() {} }

function mockRpc(handlers) {
  const calls = []
  const fn = async (name, args) => { calls.push({ name, args }); const h = handlers[name]; return typeof h === 'function' ? h(args, calls) : (h ?? { data: null, error: null }) }
  fn.calls = calls
  return fn
}
function deepEq(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]))
}

let pass = 0, fail = 0
const ok = (l) => { console.log(`  ok    ${l}`); pass++ }
const bad = (l, m) => { console.error(`  FAIL  ${l}${m ? ' — ' + m : ''}`); fail++ }
const assert = (l, c, m) => (c ? ok(l) : bad(l, m))
const eqCall = (l, call, name, args) => assert(l, call && call.name === name && deepEq(call.args, args), call ? `got ${call.name} ${JSON.stringify(call.args)}` : 'no call')

console.log('[orch-test] keyless orchestration (exact payloads)')

// 1. happy path — exact deep-equality of every call, in order
{
  const rpc = mockRpc({ start_ingestion_run: { data: 'db1', error: null }, ingest_memory_entry: { data: null, error: null }, finish_ingestion_run: { data: null, error: null } })
  const r = await runPersist({ records: records2, runMeta: meta(0), rpc, log: quiet })
  assert('happy: status success + finalized', r.status === 'success' && r.finalized)
  assert('happy: exactly 4 calls', rpc.calls.length === 4)
  eqCall('happy: call0 start exact', rpc.calls[0], 'start_ingestion_run', { p_kind: 'memory', p_embed_run_id: RUN, p_embed_counts: meta(0).embed_counts })
  eqCall('happy: call1 ingest(a) exact', rpc.calls[1], 'ingest_memory_entry', { payload: stripRunId(rec('a')) })
  eqCall('happy: call2 ingest(b) exact', rpc.calls[2], 'ingest_memory_entry', { payload: stripRunId(rec('b')) })
  eqCall('happy: call3 finish exact', rpc.calls[3], 'finish_ingestion_run', { p_id: 'db1', p_status: 'success', p_counts: { persisted: 2, failed: 0 } })
}
// 2. start fails -> throws, NO ingest, NO finish
{
  const rpc = mockRpc({ start_ingestion_run: { data: null, error: { message: 'boom' } } })
  let threw = false; try { await runPersist({ records: records2, runMeta: meta(0), rpc, log: quiet }) } catch { threw = true }
  assert('start-fail: throws', threw)
  assert('start-fail: only start called', rpc.calls.length === 1 && rpc.calls[0].name === 'start_ingestion_run')
}
// 3. all entries fail -> finish failed, exact counts
{
  const rpc = mockRpc({ start_ingestion_run: { data: 'db', error: null }, ingest_memory_entry: { data: null, error: { message: 'x' } }, finish_ingestion_run: { data: null, error: null } })
  const r = await runPersist({ records: records2, runMeta: meta(0), rpc, log: quiet })
  assert('all-fail: status failed', r.status === 'failed')
  eqCall('all-fail: finish exact', rpc.calls.at(-1), 'finish_ingestion_run', { p_id: 'db', p_status: 'failed', p_counts: { persisted: 0, failed: 2 } })
}
// 4. embed failure + all persist -> partial, exact counts
{
  const rpc = mockRpc({ start_ingestion_run: { data: 'db', error: null }, ingest_memory_entry: { data: null, error: null }, finish_ingestion_run: { data: null, error: null } })
  const r = await runPersist({ records: records2, runMeta: meta(1), rpc, log: quiet })
  assert('embed-failure: status partial', r.status === 'partial')
  eqCall('embed-failure: finish exact', rpc.calls.at(-1), 'finish_ingestion_run', { p_id: 'db', p_status: 'partial', p_counts: { persisted: 2, failed: 0 } })
}
// 5. finalize fails -> finalized false, no false success (finish still attempted with success)
{
  const rpc = mockRpc({ start_ingestion_run: { data: 'db', error: null }, ingest_memory_entry: { data: null, error: null }, finish_ingestion_run: { data: null, error: { message: 'fin' } } })
  const r = await runPersist({ records: records2, runMeta: meta(0), rpc, log: quiet })
  assert('finalize-fail: finalized=false + error surfaced', r.finalized === false && r.finalizeError === 'fin')
  eqCall('finalize-fail: finish exact', rpc.calls.at(-1), 'finish_ingestion_run', { p_id: 'db', p_status: 'success', p_counts: { persisted: 2, failed: 0 } })
}
// 6. fatal mid-run -> best-effort finalize failed (exact) + rethrow
{
  const rpc = mockRpc({ start_ingestion_run: { data: 'db', error: null }, ingest_memory_entry: () => { throw new Error('fatal') }, finish_ingestion_run: { data: null, error: null } })
  let err = null; try { await runPersist({ records: records2, runMeta: meta(0), rpc, log: quiet }) } catch (e) { err = e }
  assert('fatal: rethrows original error', err && err.message === 'fatal')
  eqCall('fatal: finish exact', rpc.calls.at(-1), 'finish_ingestion_run', { p_id: 'db', p_status: 'failed', p_counts: { persisted: 0, failed: 0, fatal: 'fatal' } })
}

console.log(`[orch-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

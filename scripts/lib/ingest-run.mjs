// Mnemosyne — persist orchestration (injectable rpc, so it's testable keyless).
// `rpc(fnName, args)` is supabase.rpc-compatible: resolves to { data, error }.
// Guarantees: no ingest_memory_entry runs if start_ingestion_run fails; status is embed-failure-aware
// (success only if all persisted AND zero embed failures); an unexpected mid-run throw best-effort
// finalizes the run as 'failed' then rethrows (original error preserved); a finalize failure is reported
// (never a false success).

import { decideStatus, stripRunId } from './ingest-validate.mjs'

export async function runPersist({ records, runMeta, rpc, log = console }) {
  const start = await rpc('start_ingestion_run', {
    p_kind: 'memory', p_embed_run_id: runMeta.run_id, p_embed_counts: runMeta.embed_counts,
  })
  if (start.error) throw new Error(`start_ingestion_run failed: ${start.error.message}`)
  const dbRunId = start.data

  let ok = 0, failed = 0
  try {
    for (const rec of records) {
      const r = await rpc('ingest_memory_entry', { payload: stripRunId(rec) })
      if (r.error) { log.error?.(`  FAIL ${rec.name}: ${r.error.message}`); failed++ } else ok++
    }
  } catch (fatal) {
    // best-effort finalize as failed; never mask the original error
    await rpc('finish_ingestion_run', { p_id: dbRunId, p_status: 'failed', p_counts: { persisted: ok, failed, fatal: String(fatal?.message ?? fatal) } }).catch(() => {})
    throw fatal
  }

  const status = decideStatus(ok, records.length, runMeta.embed_counts.failed)
  const fin = await rpc('finish_ingestion_run', { p_id: dbRunId, p_status: status, p_counts: { persisted: ok, failed } })
  return { dbRunId, ok, failed, status, finalized: !fin.error, finalizeError: fin.error?.message ?? null }
}

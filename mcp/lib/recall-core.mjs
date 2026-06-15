// Mnemosyne — mnemosyne recall core (pure/injectable, so it's testable keyless).
// Shared by server.mjs (real fetch + supabase.rpc) and test-recall.mjs (mocks). No stdout writes.

export const MODEL = 'gemini-embedding-001'
export const DIMS = 768
export const MAX_QUERY_LEN = 2000
export const MAX_K = 50
export const DEFAULT_K = 8

// Strict, bounded tool-argument validation (Aegis recall #3): no String()/parseInt() coercion.
export function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('recall: arguments must be an object')
  for (const key of Object.keys(args)) if (!['query', 'k'].includes(key)) throw new Error(`recall: unexpected argument "${key}"`)
  if (typeof args.query !== 'string') throw new Error('recall: "query" must be a string')
  const query = args.query.trim()
  if (!query) throw new Error('recall: "query" must be a non-empty string')
  if (query.length > MAX_QUERY_LEN) throw new Error(`recall: "query" exceeds ${MAX_QUERY_LEN} characters`)
  let k = DEFAULT_K
  if (args.k !== undefined) {
    if (typeof args.k !== 'number' || !Number.isInteger(args.k) || args.k < 1 || args.k > MAX_K) {
      throw new Error(`recall: "k" must be an integer in [1, ${MAX_K}]`)
    }
    k = args.k
  }
  return { query, k }
}

// Normalize a finite 768-vector to a pgvector literal; reject zero/degenerate norm.
export function toVecLiteral(values) {
  if (!Array.isArray(values) || values.length !== DIMS || !values.every(Number.isFinite)) {
    throw new Error(`bad query embedding (len ${values?.length})`)
  }
  const norm = Math.sqrt(values.reduce((s, x) => s + x * x, 0))
  if (!(norm > 0)) throw new Error('query embedding has zero norm')
  return '[' + values.map((x) => x / norm).join(',') + ']'
}

// Factory for the query embedder. fetchImpl/sleepImpl injectable for tests; AbortController bounds each
// request (Aegis recall #4); bounded retries on network / 429 / 5xx, fail-fast on other 4xx / bad data.
export function makeEmbedQuery({ apiKey, fetchImpl = fetch, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 15000, maxAttempts = 5 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  async function attempt(text) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      let res
      try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: DIMS }), signal: ctrl.signal })
      } catch (e) {
        const err = new Error(e?.name === 'AbortError' ? 'embed request timeout' : `embed request failed: ${e?.message ?? e}`)
        err.retryable = true
        throw err
      }
      if (!res.ok) {
        const body = await res.text()
        const err = new Error(`embed ${res.status}: ${body}`)
        err.retryable = res.status === 429 || res.status >= 500
        throw err
      }
      const values = (await res.json())?.embedding?.values
      return toVecLiteral(values) // throws (non-retryable) on bad/zero vector
    } finally {
      clearTimeout(timer)
    }
  }
  return async function embedQuery(text) {
    for (let a = 1; a <= maxAttempts; a++) {
      try { return await attempt(text) }
      catch (e) { if (e?.retryable && a < maxAttempts) { await sleepImpl(a * 1500); continue } throw e }
    }
    throw new Error('embed: exhausted retries')
  }
}

export function formatResults(query, rows) {
  if (!rows?.length) return `No matches for: ${query}`
  const lines = rows.map((r, i) =>
    `${i + 1}. [${Number(r.similarity).toFixed(3)}] ${r.name} (${r.kind}) — ${r.title}\n   source: ${r.source_path} · updated: ${r.updated_at} · via: ${r.matched_via}`)
  return `Top ${rows.length} for "${query}":\n\n${lines.join('\n')}`
}

// Orchestrate: validate -> embed -> recall_memory RPC -> format. embedQuery/rpc injectable.
export async function runRecall(args, { embedQuery, rpc }) {
  const { query, k } = validateArgs(args)
  const query_embedding = await embedQuery(query)
  const { data, error } = await rpc('recall_memory', { query_embedding, match_count: k })
  if (error) throw new Error(`recall_memory error: ${error.message}`)
  return formatResults(query, data)
}

// Mnemosyne — Phase 2 / Unit B: server-side semantic-recall endpoint (CF Pages Function).
//
// The browser can't hold the Gemini key or call recall_memory (service_role-only). This Function does the
// hop: verify the caller's Supabase JWT -> confirm they're an ACTIVE team member -> embed the query via
// Gemini (RETRIEVAL_QUERY, 768, normalized) -> recall_memory RPC -> return ranked results.
// Fails CLOSED: no/invalid JWT or non-member -> rejected before any embed or RPC.
//
// Runtime: Cloudflare Workers (CF Pages Functions). Secrets come from server-side env (context.env),
// NOT VITE_-prefixed, so they never enter the browser bundle:
//   SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY  (must add in CF Pages env)
//   SUPABASE_URL / SUPABASE_ANON_KEY            (fall back to the existing VITE_* if not separately set)
//
// Aegis QC (thread 0012) deferred items (NOT yet implemented — gated to before broad rollout):
//   - per-user/IP RATE LIMITING (this endpoint spends Gemini tokens) — required before broad team rollout.
//   - if recall AUDIT is ever added: log only safe metadata (actor, k, result count, timing) — NEVER the
//     query text.

import { createClient } from '@supabase/supabase-js'

const MODEL = 'gemini-embedding-001'
const DIMS = 768
const MAX_K = 50
const DEFAULT_K = 8
const MAX_QUERY_LEN = 2000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Mirrors mcp/lib/recall-core.mjs (makeEmbedQuery + toVecLiteral): RETRIEVAL_QUERY, 768-dim, unit-normalized,
// per-request abort timeout. Returns a pgvector literal string.
async function embedQuery(text: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: DIMS }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`embed ${res.status}`)
    const values = (await res.json())?.embedding?.values
    if (!Array.isArray(values) || values.length !== DIMS || !values.every((x: unknown) => Number.isFinite(x))) {
      throw new Error('bad embedding')
    }
    const norm = Math.sqrt(values.reduce((s: number, x: number) => s + x * x, 0))
    if (!(norm > 0)) throw new Error('zero norm')
    return '[' + values.map((x: number) => x / norm).join(',') + ']'
  } finally {
    clearTimeout(timer)
  }
}

export const onRequestPost = async (context: any): Promise<Response> => {
  const env = context.env || {}
  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
  const GEMINI = env.GEMINI_API_KEY
  if (!SUPABASE_URL || !ANON || !SERVICE || !GEMINI) {
    return json({ error: 'server misconfigured' }, 500)
  }

  // ---- parse + strict args (no coercion) ----
  let payload: any
  try { payload = await context.request.json() } catch { return json({ error: 'invalid JSON body' }, 400) }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return json({ error: 'body must be an object' }, 400)
  // additionalProperties:false — reject unexpected keys (project standard) before any auth/embed
  for (const key of Object.keys(payload)) if (key !== 'query' && key !== 'k') return json({ error: `unexpected field "${key}"` }, 400)
  if (typeof payload.query !== 'string') return json({ error: '"query" must be a string' }, 400)
  const query = payload.query.trim()
  if (!query) return json({ error: '"query" must be non-empty' }, 400)
  if (query.length > MAX_QUERY_LEN) return json({ error: `"query" exceeds ${MAX_QUERY_LEN} chars` }, 400)
  let k = DEFAULT_K
  if (payload.k !== undefined) {
    if (typeof payload.k !== 'number' || !Number.isInteger(payload.k) || payload.k < 1 || payload.k > MAX_K) {
      return json({ error: `"k" must be an integer in [1, ${MAX_K}]` }, 400)
    }
    k = payload.k
  }

  // ---- authz: valid JWT -> active team member (fail closed) ----
  const authz = context.request.headers.get('authorization') || ''
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  if (!token) return json({ error: 'unauthorized' }, 401)

  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await anon.auth.getUser(token)
  const uid = userData?.user?.id
  if (userErr || !uid) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: member, error: mErr } = await admin
    .from('team_members')
    .select('id')
    .eq('id', uid)
    .eq('active', true)
    .maybeSingle()
  if (mErr || !member) return json({ error: 'forbidden' }, 403)

  // ---- embed + recall ----
  let vec: string
  try { vec = await embedQuery(query, GEMINI) } catch { return json({ error: 'embedding failed' }, 502) }

  const { data, error } = await admin.rpc('recall_memory', { query_embedding: vec, match_count: k })
  if (error) return json({ error: 'recall failed' }, 502)

  return json({ results: data ?? [] })
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

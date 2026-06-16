// Mnemosyne — Sales Factory C4.2: persist a generated draft into the brain (CF Pages Function).
//
// Flow: verify JWT -> active member -> RUN THE PROHIBITED-CONTENT SCANNER (refuse 422 if not clean — the
// Aegis prerequisite gate; no row written) -> chunk + embed the markdown (RETRIEVAL_DOCUMENT, 768, normalized,
// same params as ingest-contracts) -> save_document RPC (actor = authenticated uid, origin='draft', INSERT-only
// so a draft can never overwrite an ingested final; atomic audit). Returns { id }. Fails CLOSED.
//
// Server-side env (context.env, NOT VITE_): SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (already set).
// Deferred (pre-broad-rollout): per-user rate limiting. The draft is team-readable (same model as C1 finals).

import { createClient } from '@supabase/supabase-js'
import { scanContract } from '../_lib/contract-scan'

const MODEL = 'gemini-embedding-001'
const DIMS = 768
const CHUNK_THRESHOLD = 8000, CHUNK_SIZE = 6000, CHUNK_OVERLAP = 500
const MAX_MD_LEN = 200000
const MAX_TITLE_LEN = 300
const ALLOWED_TYPES = ['mou', 'sow']   // C4.2 persists generated drafts (which are mou/sow today)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function chunkBody(b: string): string[] {
  if (b.length <= CHUNK_THRESHOLD) return [b]
  const out: string[] = []
  for (let i = 0; i < b.length; i += CHUNK_SIZE - CHUNK_OVERLAP) out.push(b.slice(i, i + CHUNK_SIZE))
  return out
}

async function embedDoc(text: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`embed ${res.status}`)
    const v = (await res.json())?.embedding?.values
    if (!Array.isArray(v) || v.length !== DIMS || !v.every((x: unknown) => Number.isFinite(x))) throw new Error('bad embedding')
    const norm = Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0))
    if (!(norm > 0)) throw new Error('zero norm')
    return '[' + v.map((x: number) => x / norm).join(',') + ']'
  } finally { clearTimeout(timer) }
}

export const onRequestPost = async (context: any): Promise<Response> => {
  const env = context.env || {}
  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
  const GEMINI = env.GEMINI_API_KEY
  if (!SUPABASE_URL || !ANON || !SERVICE || !GEMINI) return json({ error: 'server misconfigured' }, 500)

  // ---- strict args ----
  let payload: any
  try { payload = await context.request.json() } catch { return json({ error: 'invalid JSON body' }, 400) }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return json({ error: 'body must be an object' }, 400)
  for (const key of Object.keys(payload)) if (key !== 'doc_type' && key !== 'title' && key !== 'markdown') return json({ error: `unexpected field "${key}"` }, 400)
  if (typeof payload.doc_type !== 'string' || !ALLOWED_TYPES.includes(payload.doc_type)) return json({ error: `"doc_type" must be one of ${ALLOWED_TYPES.join(', ')}` }, 400)
  if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > MAX_TITLE_LEN) return json({ error: `"title" must be a non-empty string <=${MAX_TITLE_LEN} chars` }, 400)
  if (typeof payload.markdown !== 'string' || !payload.markdown.trim()) return json({ error: '"markdown" must be a non-empty string' }, 400)
  if (payload.markdown.length > MAX_MD_LEN) return json({ error: `"markdown" exceeds ${MAX_MD_LEN} chars` }, 400)
  // shape gate: only accept governed C4.1 drafts (the constant 4ward party block is present in every one),
  // not arbitrary clean markdown. Cheap proxy for "this came from /api/generate-contract".
  if (!payload.markdown.includes('4ward Motion Solutions, Inc.')) {
    return json({ error: 'markdown is not a governed 4ward draft (missing the standard party block)' }, 400)
  }
  const docType = payload.doc_type as string
  const title = payload.title.trim()
  const markdown = payload.markdown

  // ---- authz: valid JWT -> active member (fail closed) ----
  const authz = context.request.headers.get('authorization') || ''
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  if (!token) return json({ error: 'unauthorized' }, 401)
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await anon.auth.getUser(token)
  const uid = userData?.user?.id
  if (userErr || !uid) return json({ error: 'unauthorized' }, 401)
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: member, error: mErr } = await admin
    .from('team_members').select('id').eq('id', uid).eq('active', true).maybeSingle()
  if (mErr || !member) return json({ error: 'forbidden' }, 403)

  // ---- prohibited-content gate (REFUSE if not clean; no row written) ----
  const scan = scanContract(markdown)
  if (!scan.clean) {
    return json({ error: 'draft contains prohibited content and was not saved', hits: scan.hits }, 422)
  }

  // ---- chunk + embed ----
  const parts = chunkBody(markdown)
  const chunks: any[] = []
  try {
    for (let i = 0; i < parts.length; i++) {
      chunks.push({ chunk_index: i, content: parts[i], embedding: await embedDoc(parts[i], GEMINI), embedding_model: MODEL })
    }
  } catch { return json({ error: 'embedding failed' }, 502) }

  // ---- persist via the hardened service-role RPC (actor = uid, origin='draft', insert-only) ----
  const { data: docId, error: wErr } = await admin.rpc('save_document', {
    p_payload: { doc_type: docType, title, extracted_text: markdown, chunks },
    p_actor: uid,
    p_audit: { doc_type: docType, chunks: chunks.length, origin: 'draft' },
  })
  if (wErr) {
    const msg = wErr.message || ''
    if (/save_document:|too many|must be|bad |non-contiguous|not 768|not unit/i.test(msg)) return json({ error: msg }, 400)
    return json({ error: 'save failed' }, 502)
  }

  return json({ id: docId, doc_type: docType, title, chunks: chunks.length }, 201)
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

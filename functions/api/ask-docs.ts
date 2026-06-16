// Mnemosyne — Sales Factory C2: contract Q&A (RAG) endpoint (CF Pages Function).
//
// First GENERATION call in the system (vs embed/retrieve). Flow: verify JWT -> active-member check ->
// embed question (Gemini RETRIEVAL_QUERY) -> search_docs RPC (top docs) -> service-role fetch those docs'
// extracted_text -> Gemini generateContent (gemini-2.5-flash, GROUNDED: answer ONLY from the provided
// contract excerpts, cite titles, say "not found" otherwise) -> return { answer, sources[] }.
// Fails CLOSED. The synthesized answer is contract-derived text (team-readable, Jesse-accepted for C1);
// raw chunks are NOT returned — only the answer + source metadata (citations).
//
// Server-side env (context.env, NOT VITE_): SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (already set).
// Deferred (pre-broad-rollout, per Unit-B/C1 pattern): per-user rate limiting; if audit added, log safe
// metadata only (actor, doc ids, status) — NEVER the question text or answer.

import { createClient } from '@supabase/supabase-js'

const EMBED_MODEL = 'gemini-embedding-001'
const GEN_MODEL = 'gemini-2.5-flash'
const DIMS = 768
const TOP_DOCS = 4        // grounding breadth (contracts are small; full extracted_text per doc)
const MAX_Q_LEN = 1000
const MAX_CTX_CHARS = 24000  // hard cap on grounding text sent to the model

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function embedQuery(text: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: DIMS }),
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

async function generate(question: string, context: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent`
  const system =
    'You answer questions about 4ward Motion Solutions contracts (MOUs, SOWs, proposals, invoices). ' +
    'Answer ONLY from the provided contract excerpts. If the answer is not in them, say you could not find ' +
    'it in the available contracts. Be concise and factual; cite the document titles you used. Do not invent ' +
    'figures, dates, or terms.'
  const prompt = `${system}\n\n=== CONTRACT EXCERPTS ===\n${context}\n\n=== QUESTION ===\n${question}`
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    // NOTE: no responseSchema (avoids the gemini-2.5-flash structured-output truncation gotcha); plain text.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`generate ${res.status}`)
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('').trim()
    if (!text) throw new Error('empty generation')
    return text
  } finally { clearTimeout(timer) }
}

export const onRequestPost = async (context: any): Promise<Response> => {
  const env = context.env || {}
  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
  const GEMINI = env.GEMINI_API_KEY
  if (!SUPABASE_URL || !ANON || !SERVICE || !GEMINI) return json({ error: 'server misconfigured' }, 500)

  // ---- strict args (additionalProperties:false) ----
  let payload: any
  try { payload = await context.request.json() } catch { return json({ error: 'invalid JSON body' }, 400) }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return json({ error: 'body must be an object' }, 400)
  for (const key of Object.keys(payload)) if (key !== 'question') return json({ error: `unexpected field "${key}"` }, 400)
  if (typeof payload.question !== 'string') return json({ error: '"question" must be a string' }, 400)
  const question = payload.question.trim()
  if (!question) return json({ error: '"question" must be non-empty' }, 400)
  if (question.length > MAX_Q_LEN) return json({ error: `"question" exceeds ${MAX_Q_LEN} chars` }, 400)

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

  // ---- retrieve grounding docs ----
  let vec: string
  try { vec = await embedQuery(question, GEMINI) } catch { return json({ error: 'embedding failed' }, 502) }
  const { data: hits, error: sErr } = await admin.rpc('search_docs', { query_embedding: vec, match_count: TOP_DOCS })
  if (sErr) return json({ error: 'search failed' }, 502)
  if (!hits || hits.length === 0) return json({ answer: 'No relevant contracts were found for that question.', sources: [] })

  const ids = hits.map((h: any) => h.id)
  const { data: docs, error: dErr } = await admin.from('documents').select('id, title, extracted_text').in('id', ids)
  if (dErr) return json({ error: 'fetch failed' }, 502)

  // build grounding context (cap total chars), preserving search rank order
  const byId = new Map(docs!.map((d: any) => [d.id, d]))
  let ctx = '', used = 0
  const sources: any[] = []
  for (const h of hits) {
    const d: any = byId.get(h.id); if (!d) continue
    const block = `--- ${d.title} ---\n${(d.extracted_text ?? '').slice(0, 8000)}\n`
    if (used + block.length > MAX_CTX_CHARS) break
    ctx += block; used += block.length
    sources.push({ id: h.id, title: h.title, doc_type: h.doc_type, similarity: h.similarity })
  }

  // ---- generate grounded answer ----
  let answer: string
  try { answer = await generate(question, ctx, GEMINI) } catch { return json({ error: 'generation failed' }, 502) }

  return json({ answer, sources })
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

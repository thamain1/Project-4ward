// Mnemosyne — KEYLESS recall-path tests (Aegis recall #5). No network, no DB, no keys.
// Run: node mcp/test-recall.mjs

import { validateArgs, makeEmbedQuery, toVecLiteral, formatResults, runRecall, DIMS } from './lib/recall-core.mjs'

let pass = 0, fail = 0
const ok = (l) => { console.log(`  ok    ${l}`); pass++ }
const bad = (l, m) => { console.error(`  FAIL  ${l}${m ? ' — ' + m : ''}`); fail++ }
const throws = async (l, fn) => { try { await fn(); bad(l, 'expected rejection') } catch { ok(l + ' (rejected)') } }
const accepts = async (l, fn) => { try { await fn(); ok(l + ' (ok)') } catch (e) { bad(l, e.message) } }
const eq = (l, a, b) => (a === b ? ok(l) : bad(l, `${a} !== ${b}`))

const noSleep = async () => {}
const vec = (fill) => Array(DIMS).fill(fill)
const okFetch = (values) => async () => ({ ok: true, json: async () => ({ embedding: { values } }) })

console.log('[recall-test] keyless')

// --- validateArgs ---
await accepts('valid args', () => validateArgs({ query: 'hi' }))
await accepts('valid args + k', () => validateArgs({ query: 'hi', k: 5 }))
await throws('non-string query', () => validateArgs({ query: 42 }))
await throws('empty/whitespace query', () => validateArgs({ query: '   ' }))
await throws('too-long query', () => validateArgs({ query: 'x'.repeat(2001) }))
await throws('unexpected arg', () => validateArgs({ query: 'hi', foo: 1 }))
await throws('object query (no coercion)', () => validateArgs({ query: { a: 1 } }))
await throws('non-integer k', () => validateArgs({ query: 'hi', k: 2.5 }))
await throws('k = 0', () => validateArgs({ query: 'hi', k: 0 }))
await throws('k > MAX', () => validateArgs({ query: 'hi', k: 51 }))
await throws('non-object args', () => validateArgs('hi'))

// --- toVecLiteral ---
await accepts('normalize 768 (norm 1)', () => { const a = JSON.parse(toVecLiteral(vec(2))); const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0)); if (Math.abs(n - 1) > 1e-9) throw new Error('not normalized') })
await throws('wrong-length vector', () => toVecLiteral([1, 2, 3]))
await throws('zero vector', () => toVecLiteral(vec(0)))

// --- embedQuery (mock fetch/sleep) ---
await accepts('embed success -> normalized literal', async () => { const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: okFetch(vec(1)), sleepImpl: noSleep }); const a = JSON.parse(await e('q')); if (a.length !== 768) throw new Error('len') })
await throws('embed bad length -> non-retryable', async () => { const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: okFetch([1, 2, 3]), sleepImpl: noSleep }); await e('q') })
await accepts('embed retries 429 then 200 (2 calls)', async () => { let c = 0; const f = async () => { c++; return c === 1 ? { ok: false, status: 429, text: async () => 'rate' } : { ok: true, json: async () => ({ embedding: { values: vec(1) } }) } }; const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: f, sleepImpl: noSleep }); await e('q'); if (c !== 2) throw new Error('calls=' + c) })
await throws('embed 5xx exhausts retries', async () => { const f = async () => ({ ok: false, status: 500, text: async () => 'down' }); const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: f, sleepImpl: noSleep, maxAttempts: 3 }); await e('q') })
await accepts('embed 4xx fail-fast (1 call)', async () => { let c = 0; const f = async () => { c++; return { ok: false, status: 400, text: async () => 'bad' } }; const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: f, sleepImpl: noSleep, maxAttempts: 5 }); try { await e('q') } catch {} if (c !== 1) throw new Error('calls=' + c) })
await accepts('embed timeout (AbortError) retried then throws', async () => { let c = 0; const f = async () => { c++; const er = new Error('aborted'); er.name = 'AbortError'; throw er }; const e = makeEmbedQuery({ apiKey: 'k', fetchImpl: f, sleepImpl: noSleep, maxAttempts: 2 }); let msg = ''; try { await e('q') } catch (er) { msg = er.message } if (c !== 2) throw new Error('calls=' + c); if (!/timeout/.test(msg)) throw new Error('msg=' + msg) })
await accepts('embed sends RETRIEVAL_QUERY + 768 + key header + model', async () => { let cap; const f = async (u, o) => { cap = { u, o }; return { ok: true, json: async () => ({ embedding: { values: vec(1) } }) } }; const e = makeEmbedQuery({ apiKey: 'KEY', fetchImpl: f, sleepImpl: noSleep }); await e('q'); const b = JSON.parse(cap.o.body); if (b.taskType !== 'RETRIEVAL_QUERY') throw new Error('task'); if (b.outputDimensionality !== 768) throw new Error('dims'); if (cap.o.headers['x-goog-api-key'] !== 'KEY') throw new Error('hdr'); if (!/gemini-embedding-001/.test(cap.u)) throw new Error('model') })

// --- runRecall (mock embed + rpc) ---
const mockEmbed = async () => toVecLiteral(vec(1))
await accepts('runRecall exact RPC name/args + format', async () => { let call; const rpc = async (n, a) => { call = { n, a }; return { data: [{ name: 'x', title: 't', kind: 'project', source_path: 'memory/x.md', similarity: 0.9, updated_at: '2026-06-15', matched_via: 'entry' }], error: null } }; const out = await runRecall({ query: 'q', k: 3 }, { embedQuery: mockEmbed, rpc }); if (call.n !== 'recall_memory') throw new Error('rpc name'); if (call.a.match_count !== 3) throw new Error('k'); if (typeof call.a.query_embedding !== 'string') throw new Error('emb'); if (!/x \(project\)/.test(out)) throw new Error('fmt') })
await throws('runRecall RPC error -> throw', async () => { const rpc = async () => ({ data: null, error: { message: 'boom' } }); await runRecall({ query: 'q' }, { embedQuery: mockEmbed, rpc }) })
await accepts('runRecall empty -> No matches', async () => { const rpc = async () => ({ data: [], error: null }); const out = await runRecall({ query: 'zzz' }, { embedQuery: mockEmbed, rpc }); if (!/No matches/.test(out)) throw new Error(out) })
await throws('runRecall propagates validation error', async () => { await runRecall({ query: '' }, { embedQuery: mockEmbed, rpc: async () => ({ data: [], error: null }) }) })

// --- formatResults ---
eq('formatResults empty', 'No matches for: q', formatResults('q', []))
await accepts('formatResults provenance + freshness', () => { const s = formatResults('q', [{ name: 'n', title: 't', kind: 'project', source_path: 'memory/n.md', similarity: 0.8, updated_at: '2026', matched_via: 'chunk' }]); if (!/source: memory\/n.md/.test(s) || !/via: chunk/.test(s)) throw new Error(s) })

console.log(`[recall-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

// Mnemosyne — keyless tests for the remember write slice. Run: node test-remember.mjs
// No network, no DB, no keys: embedDoc/rpc/fetch are mocked. Mirrors test-recall.mjs discipline.
import {
  validateRememberArgs, scanSecret, chunkBody, extractLinks, buildRecord, runRemember,
  makeEmbedDoc, slugify, KINDS, MAX_TITLE_LEN, MAX_BODY_LEN, CHUNK_THRESHOLD,
} from './lib/remember-core.mjs'

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log(`  ok    ${name}`) } else { fail++; console.log(`  FAIL  ${name}`) } }
async function throwsAsync(fn, frag) {
  try { await fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true }
}
function throwsSync(fn, frag) {
  try { fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true }
}
const vec768 = (fill = 1) => Array.from({ length: 768 }, () => fill)
const validLiteral = '[' + vec768().map((x) => x / Math.sqrt(768)).join(',') + ']'
const goodArgs = { title: 'OTH payments', body: 'Payments run on Supabase edge functions.', kind: 'project' }
const ACTOR = '11111111-1111-1111-1111-111111111111'

// ---- validateRememberArgs ----
check('rejects non-object', throwsSync(() => validateRememberArgs('x'), 'must be an object'))
check('rejects array', throwsSync(() => validateRememberArgs([]), 'must be an object'))
check('rejects null', throwsSync(() => validateRememberArgs(null), 'must be an object'))
check('rejects unexpected key', throwsSync(() => validateRememberArgs({ ...goodArgs, foo: 1 }), 'unexpected argument'))
check('rejects missing title', throwsSync(() => validateRememberArgs({ body: 'b', kind: 'project' }), 'title'))
check('rejects empty title', throwsSync(() => validateRememberArgs({ title: '   ', body: 'b', kind: 'project' }), 'title'))
check('rejects non-string title', throwsSync(() => validateRememberArgs({ title: 5, body: 'b', kind: 'project' }), 'title'))
check('rejects long title', throwsSync(() => validateRememberArgs({ title: 'x'.repeat(MAX_TITLE_LEN + 1), body: 'b', kind: 'project' }), 'exceeds'))
check('rejects missing body', throwsSync(() => validateRememberArgs({ title: 't', kind: 'project' }), 'body'))
check('rejects empty body', throwsSync(() => validateRememberArgs({ title: 't', body: '', kind: 'project' }), 'body'))
check('rejects long body', throwsSync(() => validateRememberArgs({ title: 't', body: 'x'.repeat(MAX_BODY_LEN + 1), kind: 'project' }), 'exceeds'))
check('rejects bad kind', throwsSync(() => validateRememberArgs({ title: 't', body: 'b', kind: 'nope' }), 'kind'))
check('rejects non-string name', throwsSync(() => validateRememberArgs({ ...goodArgs, name: 5 }), 'name'))
check('rejects name slugifying to empty', throwsSync(() => validateRememberArgs({ ...goodArgs, name: '!!!' }), 'slugifies to empty'))
check('rejects title that slugifies to empty w/o name', throwsSync(() => validateRememberArgs({ title: '!!!', body: 'b', kind: 'project' }), 'slugifies to empty'))
const v1 = validateRememberArgs(goodArgs)
check('accepts good args, derives name from title', v1.name === 'oth-payments' && v1.kind === 'project' && v1.title === 'OTH payments')
check('uses explicit name (slugified)', validateRememberArgs({ ...goodArgs, name: 'My Custom Name' }).name === 'my-custom-name')
check('rejects over-long name', throwsSync(() => validateRememberArgs({ ...goodArgs, name: 'a'.repeat(90) }), 'exceeds'))
check('all four KINDS accepted', [...KINDS].every((k) => validateRememberArgs({ title: 't', body: 'b', kind: k }).kind === k))

// ---- scanSecret (incident 0006 prevention) ----
check('scan flags sbp_ token', !!scanSecret('see sbp_' + 'a'.repeat(40)))
check('scan flags JWT', !!scanSecret('tok eyJabcdefgh.ijklmnopq.rstuvwx'))
check('scan flags AIza key', !!scanSecret('AIza' + 'B'.repeat(35)))
check('scan flags sk_live', !!scanSecret('sk_live_' + 'c'.repeat(20)))
check('scan flags generic password=', !!scanSecret('password: hunter2hunter2'))
check('scan clean text returns null', scanSecret('a normal project note about payments') === null)

// ---- chunkBody / extractLinks ----
check('chunkBody single for short', chunkBody('abc').length === 1)
const big = 'x'.repeat(CHUNK_THRESHOLD + 5000)
const parts = chunkBody(big)
check('chunkBody multiple for long', parts.length > 1)
check('chunkBody covers whole body', parts.join('').length >= big.length)
check('extractLinks unique', JSON.stringify(extractLinks('see [[a]] and [[b]] and [[a]]')) === JSON.stringify(['a', 'b']))

// ---- makeEmbedDoc request shape + retry/timeout ----
{
  let captured
  const fetchOk = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ embedding: { values: vec768() } }) } }
  const embedDoc = makeEmbedDoc({ apiKey: 'KEY', fetchImpl: fetchOk })
  const lit = await embedDoc('hello')
  const sent = JSON.parse(captured.opts.body)
  check('embedDoc uses embedContent URL + model', captured.url.includes('gemini-embedding-001:embedContent'))
  check('embedDoc taskType RETRIEVAL_DOCUMENT', sent.taskType === 'RETRIEVAL_DOCUMENT')
  check('embedDoc outputDimensionality 768', sent.outputDimensionality === 768)
  check('embedDoc sends api key header', captured.opts.headers['x-goog-api-key'] === 'KEY')
  check('embedDoc normalizes to unit literal', Math.abs(JSON.parse(lit).reduce((s, x) => s + x * x, 0) - 1) < 1e-6)

  let calls = 0
  const fetch429 = async () => { calls++; return calls < 3 ? { ok: false, status: 429, text: async () => 'rate' } : { ok: true, json: async () => ({ embedding: { values: vec768() } }) } }
  const r = await makeEmbedDoc({ apiKey: 'K', fetchImpl: fetch429, sleepImpl: async () => {} })('x')
  check('embedDoc retries 429 then succeeds', calls === 3 && typeof r === 'string')

  const fetch400 = async () => ({ ok: false, status: 400, text: async () => 'bad' })
  check('embedDoc fail-fast on 4xx', await throwsAsync(() => makeEmbedDoc({ apiKey: 'K', fetchImpl: fetch400, sleepImpl: async () => {} })('x'), 'embed 400'))

  const fetchAbort = async (_u, opts) => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
  check('embedDoc surfaces timeout after retries', await throwsAsync(() => makeEmbedDoc({ apiKey: 'K', fetchImpl: fetchAbort, sleepImpl: async () => {}, maxAttempts: 2 })('x'), 'timeout'))

  const fetchBadVec = async () => ({ ok: true, json: async () => ({ embedding: { values: [1, 2, 3] } }) })
  check('embedDoc rejects bad-length vector', await throwsAsync(() => makeEmbedDoc({ apiKey: 'K', fetchImpl: fetchBadVec })('x'), 'bad'))
}

// ---- buildRecord ----
{
  const embedDoc = async () => validLiteral
  const single = await buildRecord({ title: 'T', body: 'short body [[onthehash]]', kind: 'project', name: 'oth-x' }, embedDoc)
  check('buildRecord single: embedding set, chunks empty', single.embedding === validLiteral && single.chunks.length === 0)
  check('buildRecord single: operator provenance mcp/<name>', single.source_path === 'mcp/oth-x')
  check('buildRecord single: links extracted', JSON.stringify(single.links) === JSON.stringify(['onthehash']))
  check('buildRecord single: embedding_model pinned', single.embedding_model === 'gemini-embedding-001')

  const chunked = await buildRecord({ title: 'T', body: 'y'.repeat(CHUNK_THRESHOLD + 5000), kind: 'project', name: 'big-x' }, embedDoc)
  check('buildRecord chunked: null entry embedding', chunked.embedding === null)
  check('buildRecord chunked: chunks contiguous', chunked.chunks.every((c, i) => c.chunk_index === i))
  check('buildRecord chunked: each chunk has content+embedding+model', chunked.chunks.every((c) => c.content && c.embedding === validLiteral && c.embedding_model === 'gemini-embedding-001'))
}

// ---- runRemember orchestration ----
{
  const embedDoc = async () => validLiteral
  const rpc0 = async () => ({ error: null })
  // fail closed without a valid operator actor (Aegis 0008 #1)
  check('runRemember fails closed without actorId', await throwsAsync(() => runRemember(goodArgs, { embedDoc, rpc: rpc0 }), 'operator actor'))
  check('runRemember fails closed with non-uuid actorId', await throwsAsync(() => runRemember(goodArgs, { embedDoc, rpc: rpc0, actorId: 'nope' }), 'operator actor'))

  // secret-bearing body refused BEFORE embed/rpc (valid actor so we reach the scan)
  let embedded = false, rpcCalled = false
  const embedSpy = async () => { embedded = true; return validLiteral }
  const rpcSpy = async () => { rpcCalled = true; return { error: null } }
  check('runRemember refuses secret-bearing content',
    await throwsAsync(() => runRemember({ title: 'creds', body: 'sbp_' + 'a'.repeat(40), kind: 'project' }, { embedDoc: embedSpy, rpc: rpcSpy, actorId: ACTOR }), 'refused'))
  check('runRemember does NOT embed or call rpc on secret', embedded === false && rpcCalled === false)

  // happy path: calls remember_memory with correct payload + actor + safe audit
  let argsSeen, fnSeen
  const rpc = async (fn, args) => { fnSeen = fn; argsSeen = args; return { error: null } }
  const msg = await runRemember({ title: 'OTH payments', body: 'Payments via Supabase EFs [[onthehash]]', kind: 'project' }, { embedDoc, rpc, actorId: ACTOR })
  check('runRemember calls remember_memory', fnSeen === 'remember_memory')
  check('runRemember passes operator actor', argsSeen.p_actor === ACTOR)
  check('runRemember payload keys correct', JSON.stringify(Object.keys(argsSeen.p_payload).sort()) === JSON.stringify(['body', 'chunks', 'embedding', 'embedding_model', 'kind', 'links', 'name', 'source_path', 'title']))
  check('runRemember operator provenance mcp/<slug>', argsSeen.p_payload.name === 'oth-payments' && argsSeen.p_payload.source_path === 'mcp/oth-payments')
  check('runRemember audit = safe metadata, no body', argsSeen.p_audit && argsSeen.p_audit.kind === 'project' && typeof argsSeen.p_audit.chunks === 'number' && !('body' in argsSeen.p_audit))
  check('runRemember success message', msg.includes('Remembered "OTH payments"') && msg.includes('oth-payments') && msg.includes('1 vector'))

  // rpc error surfaces
  const rpcErr = async () => ({ error: { message: 'collision' } })
  check('runRemember surfaces rpc error', await throwsAsync(() => runRemember(goodArgs, { embedDoc, rpc: rpcErr, actorId: ACTOR }), 'remember_memory error'))

  // validation error short-circuits before embed
  let embedded2 = false
  check('runRemember rejects bad args before embed', await throwsAsync(() => runRemember({ title: '', body: 'b', kind: 'project' }, { embedDoc: async () => { embedded2 = true; return validLiteral }, rpc, actorId: ACTOR }), 'title'))
  check('runRemember no embed on invalid args', embedded2 === false)

  // fan-out bound: oversized body rejected BEFORE any embed (Aegis 0007 #3)
  let embedded3 = false
  check('runRemember rejects oversized body (chunk cap) before embed',
    await throwsAsync(() => runRemember({ title: 'big', body: 'z'.repeat(80000), kind: 'project' }, { embedDoc: async () => { embedded3 = true; return validLiteral }, rpc, actorId: ACTOR }), 'too large'))
  check('runRemember no embed when over chunk cap', embedded3 === false)
}

console.log(`[remember-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

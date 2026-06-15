// Project 4ward — keyless tests for the log_update append slice. Run: node test-log.mjs
// No network/DB/keys: rpc is mocked. Mirrors test-remember.mjs discipline.
import { validateLogArgs, scanObjectSecrets, runLogUpdate, MAX_DETAIL_KEYS, MAX_DETAIL_STR } from './lib/log-core.mjs'

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log(`  ok    ${name}`) } else { fail++; console.log(`  FAIL  ${name}`) } }
async function throwsAsync(fn, frag) { try { await fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true } }
function throwsSync(fn, frag) { try { fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true } }
const ACTOR = '11111111-1111-1111-1111-111111111111'

// ---- validateLogArgs ----
check('rejects non-object', throwsSync(() => validateLogArgs('x'), 'must be an object'))
check('rejects unexpected key', throwsSync(() => validateLogArgs({ action: 'a.b', foo: 1 }), 'unexpected argument'))
check('rejects missing action', throwsSync(() => validateLogArgs({}), 'action'))
check('rejects non-namespaced action', throwsSync(() => validateLogArgs({ action: 'note' }), 'namespaced'))
check('rejects action with spaces', throwsSync(() => validateLogArgs({ action: 'work note' }), 'namespaced'))
check('rejects UPPER action', throwsSync(() => validateLogArgs({ action: 'Work.Note' }), 'namespaced'))
check('accepts namespaced action', validateLogArgs({ action: 'work.note' }).action === 'work.note')
check('accepts deep namespaced action', validateLogArgs({ action: 'memory.remember.v2' }).action === 'memory.remember.v2')
check('rejects over-long action', throwsSync(() => validateLogArgs({ action: 'a.' + 'b'.repeat(250) }), 'exceeds'))
check('rejects non-string entity_type', throwsSync(() => validateLogArgs({ action: 'a.b', entity_type: 5 }), 'entity_type'))
check('accepts entity_type', validateLogArgs({ action: 'a.b', entity_type: 'project' }).entity_type === 'project')
check('rejects non-uuid entity_id', throwsSync(() => validateLogArgs({ action: 'a.b', entity_id: 'nope' }), 'uuid'))
check('accepts uuid entity_id', validateLogArgs({ action: 'a.b', entity_id: ACTOR }).entity_id === ACTOR)
check('rejects non-object detail', throwsSync(() => validateLogArgs({ action: 'a.b', detail: 'x' }), 'detail'))
check('rejects array detail', throwsSync(() => validateLogArgs({ action: 'a.b', detail: [] }), 'detail'))
check('rejects nested-object detail', throwsSync(() => validateLogArgs({ action: 'a.b', detail: { a: { b: 1 } } }), 'flat'))
check('rejects nested-array detail', throwsSync(() => validateLogArgs({ action: 'a.b', detail: { a: [1] } }), 'flat'))
check('rejects too-many-keys detail', throwsSync(() => validateLogArgs({ action: 'a.b', detail: Object.fromEntries(Array.from({ length: MAX_DETAIL_KEYS + 1 }, (_, i) => [`k${i}`, 1])) }), 'too many keys'))
check('rejects over-long string value', throwsSync(() => validateLogArgs({ action: 'a.b', detail: { x: 'y'.repeat(MAX_DETAIL_STR + 1) } }), 'too long'))
check('rejects multibyte detail over 4096 BYTES (char-count would pass)', throwsSync(() => validateLogArgs({ action: 'a.b', detail: { x: '✓'.repeat(700), y: '✓'.repeat(700) } }), 'bytes'))
check('accepts flat scalar detail', JSON.stringify(validateLogArgs({ action: 'a.b', detail: { n: 1, s: 'ok', f: true, z: null } }).detail) === JSON.stringify({ n: 1, s: 'ok', f: true, z: null }))
check('detail defaults to {}', JSON.stringify(validateLogArgs({ action: 'a.b' }).detail) === '{}')

// ---- scanObjectSecrets ----
check('scan flags secret string value', !!scanObjectSecrets({ tok: 'sbp_' + 'a'.repeat(40) }))
check('scan flags secret in key', !!scanObjectSecrets({ ['sk_live_' + 'a'.repeat(20)]: 'x' }))
check('scan clean object null', scanObjectSecrets({ a: 'fine', n: 3 }) === null)

// ---- runLogUpdate ----
{
  let argsSeen, fnSeen
  const rpc = async (fn, args) => { fnSeen = fn; argsSeen = args; return { data: 'aud-id', error: null } }
  check('fails closed without actorId', await throwsAsync(() => runLogUpdate({ action: 'work.note' }, { rpc }), 'operator actor'))
  check('fails closed with bad actorId', await throwsAsync(() => runLogUpdate({ action: 'work.note' }, { rpc, actorId: 'x' }), 'operator actor'))

  const msg = await runLogUpdate({ action: 'work.note', entity_type: 'project', entity_id: ACTOR, detail: { note: 'shipped recall' } }, { rpc, actorId: ACTOR })
  check('calls log_activity', fnSeen === 'log_activity')
  check('passes actor + action + entity + detail', argsSeen.p_actor === ACTOR && argsSeen.p_action === 'work.note' && argsSeen.p_entity_type === 'project' && argsSeen.p_entity_id === ACTOR && argsSeen.p_detail.note === 'shipped recall')
  check('success message includes id', msg.includes('work.note') && msg.includes('aud-id'))

  check('refuses secret in detail before rpc', await throwsAsync(() => runLogUpdate({ action: 'work.note', detail: { tok: 'sbp_' + 'a'.repeat(40) } }, { rpc, actorId: ACTOR }), 'refused'))
  check('refuses secret in entity_type', await throwsAsync(() => runLogUpdate({ action: 'work.note', entity_type: 'sbp_' + 'a'.repeat(40) }, { rpc, actorId: ACTOR }), 'refused'))
  check('refuses xox secret in entity_type', await throwsAsync(() => runLogUpdate({ action: 'work.note', entity_type: 'xoxb-' + '1'.repeat(20) }, { rpc, actorId: ACTOR }), 'refused'))

  const rpcErr = async () => ({ error: { message: 'actor not active' } })
  check('surfaces rpc error', await throwsAsync(() => runLogUpdate({ action: 'work.note' }, { rpc: rpcErr, actorId: ACTOR }), 'log_activity error'))
}

console.log(`[log-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

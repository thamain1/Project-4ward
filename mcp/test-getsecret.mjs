// Project 4ward — keyless tests for the get_secret read slice. Run: node test-getsecret.mjs
// No network/DB/keys: rpc mocked. Mirrors the other slices' discipline.
import { validateGetSecretArgs, runGetSecret } from './lib/getsecret-core.mjs'

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log(`  ok    ${name}`) } else { fail++; console.log(`  FAIL  ${name}`) } }
async function throwsAsync(fn, frag) { try { await fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true } }
function throwsSync(fn, frag) { try { fn(); return false } catch (e) { return frag ? String(e.message).includes(frag) : true } }
const ACTOR = '11111111-1111-1111-1111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'

// ---- validateGetSecretArgs ----
check('rejects non-object', throwsSync(() => validateGetSecretArgs('x'), 'must be an object'))
check('rejects array', throwsSync(() => validateGetSecretArgs([]), 'must be an object'))
check('rejects null', throwsSync(() => validateGetSecretArgs(null), 'must be an object'))
check('rejects unexpected key', throwsSync(() => validateGetSecretArgs({ secret_id: SID, foo: 1 }), 'unexpected argument'))
check('rejects missing secret_id', throwsSync(() => validateGetSecretArgs({}), 'uuid'))
check('rejects non-uuid secret_id', throwsSync(() => validateGetSecretArgs({ secret_id: 'nope' }), 'uuid'))
check('rejects numeric secret_id', throwsSync(() => validateGetSecretArgs({ secret_id: 5 }), 'uuid'))
check('accepts valid uuid', validateGetSecretArgs({ secret_id: SID }).secret_id === SID)

// ---- runGetSecret ----
{
  let argsSeen, fnSeen
  const rpc = async (fn, a) => { fnSeen = fn; argsSeen = a; return { data: 'THE-SECRET-VALUE', error: null } }
  check('fails closed without actorId', await throwsAsync(() => runGetSecret({ secret_id: SID }, { rpc }), 'operator actor'))
  check('fails closed with bad actorId', await throwsAsync(() => runGetSecret({ secret_id: SID }, { rpc, actorId: 'x' }), 'operator actor'))

  const out = await runGetSecret({ secret_id: SID }, { rpc, actorId: ACTOR })
  check('calls get_secret_operator', fnSeen === 'get_secret_operator')
  check('passes actor + id', argsSeen.p_actor === ACTOR && argsSeen.p_id === SID)
  check('returns the decrypted value', out === 'THE-SECRET-VALUE')

  check('rejects bad args before rpc', await throwsAsync(() => runGetSecret({ secret_id: 'bad' }, { rpc, actorId: ACTOR }), 'uuid'))

  const rpcErr = async () => ({ error: { message: 'not authorized for admin secret' } })
  check('surfaces rpc error (authz)', await throwsAsync(() => runGetSecret({ secret_id: SID }, { rpc: rpcErr, actorId: ACTOR }), 'get_secret_operator error'))

  const rpcNull = async () => ({ data: null, error: null })
  check('raises on null value', await throwsAsync(() => runGetSecret({ secret_id: SID }, { rpc: rpcNull, actorId: ACTOR }), 'no value returned'))

  // bad-args path must not call the rpc
  let called = false
  const rpcSpy = async () => { called = true; return { data: 'x', error: null } }
  await throwsAsync(() => runGetSecret({ secret_id: 'bad' }, { rpc: rpcSpy, actorId: ACTOR }))
  check('no rpc call on invalid args', called === false)
}

console.log(`[getsecret-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

// Mnemosyne — mnemosyne get_secret core (pure/injectable, testable keyless). No stdout writes.
// Reads a decrypted secret VALUE via the hardened, service-role-only get_secret_operator RPC (migration
// 0010), which enforces sensitivity authorization against the configured operator actor and audits the
// read (secret.read) atomically. This tool is the on-demand credential-sharing feature.
//
// SCOPE (Aegis 0009): interim LOCAL single-operator ONLY. The server holds the service-role key + an
// active OPERATOR_MEMBER_ID; the RPC attributes + sensitivity-gates by that actor. The decrypted value is
// returned to the operator's own Claude Code (already trusted with the service-role key). NEVER distribute
// the server; never log the secret value (it travels only in the JSON-RPC tool result, never to stderr).

import { isUuid } from './remember-core.mjs'

// Strict, bounded arg validation — no coercion (mirrors the recall/remember/log slices).
export function validateGetSecretArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('get_secret: arguments must be an object')
  for (const k of Object.keys(args)) if (k !== 'secret_id') throw new Error(`get_secret: unexpected argument "${k}"`)
  if (!isUuid(args.secret_id)) throw new Error('get_secret: "secret_id" must be a uuid string')
  return { secret_id: args.secret_id }
}

// Orchestrate: actor-gate -> validate -> get_secret_operator RPC -> return the value. rpc/actorId injectable.
export async function runGetSecret(args, { rpc, actorId }) {
  if (!isUuid(actorId)) throw new Error('get_secret: no valid operator actor configured (OPERATOR_MEMBER_ID) — refusing to read')
  const { secret_id } = validateGetSecretArgs(args)
  const { data, error } = await rpc('get_secret_operator', { p_actor: actorId, p_id: secret_id })
  if (error) throw new Error(`get_secret_operator error: ${error.message}`)
  if (data === null || data === undefined) throw new Error('get_secret: no value returned')
  // The decrypted value IS the tool result (the feature). It is never logged.
  return String(data)
}

// Project 4ward — 4ward-brain log_update core (pure/injectable, testable keyless). No stdout writes.
// Appends a who-did-what row to activity_log via the hardened, service-role-only log_activity RPC (0009).
// actorId = server-configured ACTIVE operator team_member (fail closed). Standalone audit tool; domain
// writes that REQUIRE audit (e.g. remember) use their own transactional RPC instead.

import { scanSecret, isUuid } from './remember-core.mjs'

export const ACTION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/   // namespaced; narrative goes in detail
export const MAX_ACTION_LEN = 200
export const MAX_ENTITY_TYPE_LEN = 100
export const MAX_DETAIL_BYTES = 4096
export const MAX_DETAIL_KEYS = 30
export const MAX_DETAIL_STR = 1000

// Recursive secret scan over keys + string values (detail is validated flat, but walk defensively).
export function scanObjectSecrets(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (scanSecret(k)) return 'secret-like key'
    if (typeof v === 'string' && scanSecret(v)) return `secret-like value at "${k}"`
    if (v && typeof v === 'object') { const r = scanObjectSecrets(v); if (r) return r }
  }
  return null
}

export function validateLogArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('log_update: arguments must be an object')
  for (const k of Object.keys(args)) if (!['action', 'entity_type', 'entity_id', 'detail'].includes(k)) throw new Error(`log_update: unexpected argument "${k}"`)
  if (typeof args.action !== 'string' || !args.action) throw new Error('log_update: "action" must be a non-empty string')
  if (args.action.length > MAX_ACTION_LEN) throw new Error(`log_update: "action" exceeds ${MAX_ACTION_LEN} chars`)
  if (!ACTION_RE.test(args.action)) throw new Error('log_update: "action" must be namespaced like "memory.remember"')
  let entity_type = null
  if (args.entity_type !== undefined) {
    if (typeof args.entity_type !== 'string' || !args.entity_type) throw new Error('log_update: "entity_type" must be a non-empty string')
    if (args.entity_type.length > MAX_ENTITY_TYPE_LEN) throw new Error('log_update: "entity_type" too long')
    entity_type = args.entity_type
  }
  let entity_id = null
  if (args.entity_id !== undefined) {
    if (!isUuid(args.entity_id)) throw new Error('log_update: "entity_id" must be a uuid string')
    entity_id = args.entity_id
  }
  let detail = {}
  if (args.detail !== undefined) {
    if (typeof args.detail !== 'object' || args.detail === null || Array.isArray(args.detail)) throw new Error('log_update: "detail" must be a JSON object')
    if (Object.keys(args.detail).length > MAX_DETAIL_KEYS) throw new Error(`log_update: "detail" has too many keys (>${MAX_DETAIL_KEYS})`)
    for (const [k, v] of Object.entries(args.detail)) {
      if (v !== null && typeof v === 'object') throw new Error(`log_update: "detail" must be flat (no nested object/array at "${k}")`)
      if (typeof v === 'string' && v.length > MAX_DETAIL_STR) throw new Error(`log_update: "detail.${k}" string too long (>${MAX_DETAIL_STR})`)
    }
    if (Buffer.byteLength(JSON.stringify(args.detail), 'utf8') > MAX_DETAIL_BYTES) throw new Error(`log_update: "detail" exceeds ${MAX_DETAIL_BYTES} bytes`)
    detail = args.detail
  }
  return { action: args.action, entity_type, entity_id, detail }
}

export async function runLogUpdate(args, { rpc, actorId }) {
  if (!isUuid(actorId)) throw new Error('log_update: no valid operator actor configured (OPERATOR_MEMBER_ID) — refusing to write')
  const { action, entity_type, entity_id, detail } = validateLogArgs(args)
  const reason = scanSecret(action) || (entity_type && scanSecret(entity_type) && `secret-like entity_type`) || scanObjectSecrets(detail)
  if (reason) throw new Error(`log_update refused: ${reason} — secrets must not be stored in the activity log`)
  const { data, error } = await rpc('log_activity', { p_actor: actorId, p_action: action, p_entity_type: entity_type, p_entity_id: entity_id, p_detail: detail })
  if (error) throw new Error(`log_activity error: ${error.message}`)
  return `Logged "${action}"${entity_type ? ` on ${entity_type}` : ''} (id ${data ?? '?'}).`
}

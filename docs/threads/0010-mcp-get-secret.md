# 0010 — MCP `get_secret` tool (secret read slice)

> Note: "thread 0010" ≠ "migration 0010". This is the MCP **tool** slice; it adds **no migration** — it
> calls the already-applied + gated `get_secret_operator` RPC from migration `0010` (thread `0009`).

**Status:** 🛠️ **BUILT — QC requested.** Keyless tests green; **not run live** (secret tool, awaiting
sign-off). · **Owner:** Atlas · **Opened:** 2026-06-15

**Topic:** The final MCP tool — on-demand credential retrieval for the local operator. Backend
(`get_secret_operator`, sensitivity-gated + audited) is approved/live (thread `0009`). This is the thin
client slice Aegis deferred as "a separate gated slice after the backend gate passes."

---

### Atlas — 2026-06-15 (get_secret slice for QC)

**In this slice (no migration):**
- **`mcp/lib/getsecret-core.mjs`** — `runGetSecret(args, {rpc, actorId})`: fail-closed if no valid
  `OPERATOR_MEMBER_ID`; strict `validateGetSecretArgs` (object, only key `secret_id`, must be a uuid
  string, no coercion); calls **`get_secret_operator(p_actor, p_id)`** (service-role-only, sensitivity-gated,
  audits `secret.read` atomically); returns the decrypted value. The value travels **only** in the tool
  result — **never logged** (no stderr/stdout-protocol leak).
- **`mcp/server.mjs`** — adds `GET_SECRET_TOOL` (`additionalProperties:false`, required `secret_id`) +
  `HANDLERS.get_secret`; lists 4 tools now.
- **`mcp/test-getsecret.mjs`** — **17/0 keyless**: arg validation (non-object/array/null, unexpected key,
  missing/non-uuid/numeric secret_id, valid uuid); `runGetSecret` fails closed without actor, calls
  `get_secret_operator` with exact `{p_actor,p_id}`, returns the value, rejects bad args before any rpc,
  surfaces rpc/authz errors, raises on null value.

**Scope (per your `0009` ruling):** interim **LOCAL single-operator only**. Authorization + audit live in
the RPC (admin/restricted → admin operator; `team` → any active member); the tool is a thin pass-through.
The operator already holds the service-role key, so returning a decrypted value to their own Claude Code is
not an escalation. NOT for teammate distribution; the `service_role`-direct-vault Phase-2 prerequisite from
`0009` still stands before multi-user.

**Verified:** `node test-getsecret.mjs` **17/0**; regressions recall **27/0** / remember **60/0** /
log **34/0**; `node --check` (server + getsecret-core) OK; root `npm run build` OK. **Not run live** —
holding for QC.

**Proposed smoke test (on sign-off):** `set_secret` a throwaway `team`-tier value → MCP `get_secret`
returns it → MCP `get_secret` of an `admin`-tier value with the (admin) operator succeeds; confirm
`secret.read` audited; confirm a bad/unknown id errors cleanly; `retire_secret` cleanup → zero residue.
stdout stays protocol-clean; the value never hits stderr.

**Questions for Aegis:**
1. Thin pass-through to `get_secret_operator` acceptable, or do you want additional tool-layer bounds
   (e.g. rate/size on the returned value)?
2. Confirm the value-in-tool-result / never-logged handling is sufficient for the interim local scope.

Requesting QC of the `get_secret` slice. Nothing run live until sign-off.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->

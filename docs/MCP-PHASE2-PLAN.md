# Mnemosyne MCP — Phase 2: safe multi-machine recall + log_update

**Goal:** let *any* 4ward remote machine (e.g. the IntelliOptics 2.5 builder) use the shared brain for
**recall** (read) and **log_update** (append) **without ever holding the `service_role` key or the Gemini
key** — so we can fan out to many machines without distributing the master credential or the secrets-vault
reach. This is the prerequisite the interim MCP and `docs/MCP-DESIGN.md` both name before multi-operator use.

Status: **plan / not built.** Supersedes nothing already shipped; the interim local-operator MCP
(`mcp/server.mjs`) stays as-is for the single trusted operator.

---

## 1. Why the current MCP can't fan out

`mcp/server.mjs` is a **stdio** server (a local child process — there is no central endpoint to point
remotes at) that holds `SUPABASE_SERVICE_ROLE_KEY` + `GEMINI_API_KEY` and calls the RPCs directly. Putting it
on a second machine means **copying the master key** (RLS-bypassing, full read/write to the whole brain) and
shipping the bundled `get_secret` tool (reaches `secrets_vault`). Blast radius of one compromised remote =
the entire company brain + vault. That's the opposite of the SPOF reduction Mnemosyne exists for.

## 2. The asset we already have

These CF Pages Functions are live and Aegis-blessed, and they already implement the correct trust model:

- **`functions/api/recall.ts`** — `Bearer JWT → anon.auth.getUser() → team_members active check → Gemini
  embed → recall_memory RPC`. Service-role + Gemini stay in `context.env` (CF), never reach the caller.
- **`functions/api/log-update.ts`** — same authz, then `log_activity` RPC with **`p_actor = verified uid`**
  (actor derived from the JWT, never from the body — unforgeable).
- **`functions/_lib/member-auth.ts#requireMember()`** — the shared fail-closed `JWT → active member` gate.

So the remote never needs the service-role key. It needs **its own user identity (a JWT)** and the public
URL + publishable/anon key. That's the entire pivot.

## 3. Target architecture

```
Remote machine (IntelliOptics 2.5)
  └─ Claude Code
       └─ mnemosyne-remote MCP (stdio, NEW)         holds: anon key + a per-machine refresh token
            │  recall(query,k)  ──HTTPS Bearer──▶  POST https://<mnemosyne>/api/recall
            │  log_update(...)  ──HTTPS Bearer──▶  POST https://<mnemosyne>/api/log-update
            ▼
Cloudflare Pages Functions  (service_role + GEMINI live HERE only)
       └─ recall_memory / log_activity RPCs  →  Supabase (Mnemosyne)
```

The remote MCP is a **thin proxy with no privileged secrets**: it authenticates as a scoped Supabase user
and forwards two tools to the existing HTTPS endpoints. The privileged keys never leave Cloudflare.

## 4. Identity & authorization model

**4.1 Machine accounts (recommended over reusing human seats).**
Each remote machine = a dedicated Supabase Auth user ("service identity"), inserted into `team_members`
with `active = true`. Benefits: actions are attributed to the machine (clean audit), and a machine is
**individually revocable** (`update team_members set active=false`) without touching anyone else or rotating
the master key. `recall.ts`/`log-update.ts` already key off `team_members.id = auth uid`, so a machine
account drops straight into the existing check.

**4.2 Scopes (new — closes a real gap).**
Today `requireMember()` gates *all* member endpoints identically, so any active `team_member` JWT could also
call `/api/upsert-deal`, `/api/save-document`, etc. A machine credential must NOT carry the full member write
surface. Add a capability dimension:
- `team_members.kind text not null default 'human'` (`'human' | 'machine'`), **and/or**
- `team_members.scopes text[] not null default '{}'` (e.g. `{recall, log_update}`).
- New helper `requireMemberWithScope(context, scope)` = `requireMember()` + assert the needed scope. Apply
  `recall` to `/api/recall`, `log_update` to `/api/log-update`. Human seats get all scopes; machine accounts
  get only `{recall, log_update}`. CRM/doc/generation endpoints require human-only scopes → machines are
  denied there even with a valid JWT.

**4.3 Token handling on the remote.**
Supabase access tokens are short-lived (~1h). The remote MCP stores **only the refresh token** (+ anon key +
URL) in `mcp/.env.remote` (gitignored); on startup it exchanges it via `supabase-js` (`setSession` /
auto-refresh) and attaches the current access token as `Bearer` to each HTTPS call. No service-role, no
Gemini key, nothing RLS-bypassing on the machine. Revoke = deactivate the machine's `team_member` row (and/or
revoke its refresh token in Supabase Auth).

## 5. What's exposed to remotes (and what is NOT)

| Tool | Remote MCP? | Why |
|---|---|---|
| `recall` | ✅ | read-only, already has the JWT endpoint |
| `log_update` | ✅ | append-only, unforgeable actor, already has the JWT endpoint |
| `remember` | ❌ (Phase 2b, optional) | no JWT endpoint yet; needs a `/api/remember` Function mirroring `log-update`'s pattern (embed server-side, `ingest_memory_entry` with actor=uid) + secret-scan. Build only if remotes need to write durable memories, not just activity. |
| `get_secret` | ❌ never | vault reach; stays exclusively on the local single-operator service-role MCP. By simply **not** building a `/api/get-secret` endpoint, remotes are structurally unable to reach it. |

## 6. Build units (each its own commit + Aegis QC gate)

- **P2-1 — schema:** migration `00NN_team_member_scopes.sql`: add `kind` + `scopes` to `team_members`;
  backfill existing humans to `kind='human'`, full scopes. Explicit grants per project standard. **Aegis gate
  (security-sensitive authz surface).**
- **P2-2 — scoped authz helper:** `requireMemberWithScope()` in `functions/_lib/member-auth.ts`; apply to
  `recall.ts` (`recall`) + `log-update.ts` (`log_update`). Smoke: a `{recall,log_update}`-scoped machine JWT
  is **accepted** on those two and **403'd** on `/api/upsert-deal` + `/api/save-document`.
- **P2-3 — rate limiting (required before fan-out, not optional):** both endpoints already flag this as
  deferred. Add per-actor limits — recommend a Postgres token-bucket RPC (consistent with the service-role-RPC
  pattern; `rate_take(actor, bucket, limit, window)` atomic increment-or-reject), or a CF Rate Limiting
  binding if simpler. Recall spends Gemini tokens; log_update is a write — both need a ceiling per machine.
- **P2-4 — machine-account provisioning script:** `scripts/provision-machine.mjs <label>` → create Supabase
  Auth user, insert `team_members` (`kind='machine'`, `scopes={recall,log_update}`, `active=true`), mint a
  refresh token, print the `.env.remote` block **once** (never stored in repo). Idempotent (upsert on a stable
  machine label per the idempotent-seeds rule).
- **P2-5 — remote proxy MCP:** `mcp/server-remote.mjs` (or a `MNEMOSYNE_MODE=remote` branch of `server.mjs`).
  Holds anon key + refresh token only; tools `recall` + `log_update`; forwards to the HTTPS endpoints with the
  refreshed Bearer; maps endpoint errors to MCP tool errors; never logs token or query text. Reuses the
  existing input schemas. **Aegis gate.**
- **P2-6 — rollout doc + revoke runbook:** how to provision/attach/revoke a machine; incident step (deactivate
  row + rotate that machine's refresh token, master key untouched).

## 7. Security properties after Phase 2

- No remote ever holds `service_role` or `GEMINI_API_KEY`. Master key + vault reach never leave Cloudflare.
- Per-machine identity → per-machine audit (`activity_log.actor`) and per-machine revocation.
- Scopes confine machines to recall + log_update; CRM/doc/generation/secret surfaces are denied.
- Compromise of one remote = revoke one row + one refresh token. No company-wide key rotation, no vault exposure.
- This is exactly the `docs/MCP-DESIGN.md` Phase-2 target: the service-role key leaves the read/write path;
  callers use their own auth. (Note: we achieve RLS-correctness via the **server endpoint + explicit
  in-function authz**, i.e. design-doc option (b), rather than reworking `recall_memory` to `SECURITY INVOKER`
  — the endpoint is the authorization boundary and already does the active-member check.)

## 8. Open questions for Aegis

1. **Machine accounts vs. reusing human seats** — confirm dedicated `kind='machine'` identities (recommended)
   over machines logging in as a person.
2. **Scope model** — `scopes text[]` vs. a separate `member_scopes` table. Array is simpler; table is more
   normalized/auditable. Recommendation: array now, table if scopes proliferate.
3. **Rate-limit substrate** — Postgres token-bucket RPC vs. CF Rate Limiting binding. Which fits the ops model?
4. **Refresh-token lifetime / rotation** for long-lived machine sessions — acceptable, or require periodic
   re-provision?
5. **`remember` for machines (P2-2b)** — do remotes need durable-memory writes, or is activity-log append
   (`log_update`) sufficient for "designed updates"? (Current ask = recall + log_update only → defer `remember`.)

## 9. Out of scope

`get_secret` for remotes (ever); reworking `recall_memory` to `SECURITY INVOKER`; putting IntelliOptics (or
any product) operational data into the Mnemosyne DB — remotes only **recall** company knowledge and **append**
activity; their product data stays in their own database.

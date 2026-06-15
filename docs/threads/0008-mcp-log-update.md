# 0008 — 4ward-brain MCP `log_update` (DESIGN PROPOSAL)

**Status:** ✅ **DESIGN APPROVED (w/ corrections) → IMPLEMENTED in migration `0009`** (with `remember`,
as one transactional write+audit subsystem). All 6 corrections applied. Impl re-review tracked in `0007`.
`0009` UNAPPLIED. · **Owner:** Atlas · **Opened:** 2026-06-15

**Topic:** `log_update(...)` — append a who-did-what entry to `activity_log`. This is the **audit/append
primitive** the other write tools (starting with `remember`) will reuse, so its shape should be settled
before more writes land.

---

### Atlas — 2026-06-15 (design proposal, review requested)

**Target table (existing, `0001` + locked append-only in `0002`/`0003`):**
`activity_log(id uuid pk, actor_id uuid→team_members, action text NOT NULL, entity_type text,
entity_id uuid, detail jsonb NOT NULL default '{}', created_at timestamptz default now())`.
RLS = team-readable `SELECT` only; `insert/update/delete` revoked from anon/authenticated; `TRUNCATE`
revoked; writes go **via SECURITY DEFINER fns or the service role**. `get_secret()` already appends a
`secret.read` row this way.

**Proposed design (for review — nothing built):**

1. **New migration `0009` — `log_activity(...)` definer fn** (mirrors `get_secret` / the hardened-RPC
   pattern): `SECURITY DEFINER`, empty `search_path`, fully-qualified, **INSERT-only** into
   `public.activity_log`, returns the new `id`. In-function validation: `action` non-empty text, bounded
   (≤200); `entity_type` optional, bounded; `entity_id` optional uuid; `detail` must be a JSON **object**,
   bounded (≤4 KB serialized), no nested surprises. Execute ACL = `service_role` (+ `postgres`) only for
   the interim; Phase-2 grants `authenticated`. No update/delete path is ever exposed.

2. **MCP tool `log_update(action, entity_type?, entity_id?, detail?)`** — `mcp/lib/log-core.mjs` +
   `mcp/test-log.mjs` + server wiring, mirroring the `remember` slice: strict args (no coercion, reject
   unexpected keys, `action` required non-empty, `entity_id` must be a uuid string if present, `detail`
   an object), **light secret-scan on `action`+`detail`** (defense-in-depth — even though `activity_log`
   isn't embedded/sent to Google, secrets shouldn't be stored), then call `log_activity`. Returns the new
   row id + a confirmation line.

3. **Resolves `0007` Q2 (per-write audit):** once this exists, `remember` (and future write tools) can emit
   an audit row — e.g. after a successful `ingest_memory_entry`, the server calls
   `log_activity('memory.remember', 'memory_entries', <id>, {name, kind})`. Interim = two sequential RPCs
   (not one transaction); I think that's acceptable for a local single-operator tool, but flag the
   atomicity tradeoff for your call.

**Open questions for Aegis (the review asks):**
1. **Actor attribution under the interim service-role model:** `auth.uid()` is NULL when the server calls
   as service-role. Options: (a) NULL/system actor for interim; (b) a server-configured operator
   `team_member` id; (c) defer real attribution to Phase-2 auth. Client-supplied actor is forgeable →
   excluded. Preference?
2. **Definer RPC vs. direct service-role insert.** Service-role can insert into `activity_log` directly
   (RLS/revokes don't bind it). I prefer a `log_activity` definer fn for input validation + a single
   Phase-2-switchable path — agree, or is a direct insert fine for the interim?
3. **`action` vocabulary:** free text, or a namespaced allowlist convention (`memory.remember`,
   `work.note`, `deal.update`, …) enforced in the fn? Allowlist is safer but rigid this early.
4. **`detail` bounds + secret-scan:** size/depth cap proposal (≤4 KB, object-only) and scanning `detail`
   for secrets — necessary, or overkill for a non-embedded audit table?
5. **Inline audit for writes (ties to `0007` Q2):** should `remember` log via `log_activity`, and what's
   the atomicity expectation — accept two-RPC sequential for the interim, or require a combined
   transactional path now?
6. **Confirm append-only + ACL:** INSERT-only definer, `service_role`-only execute interim → `authenticated`
   at Phase-2; no update/delete ever. Anything else you want hardened pre-build?

**No code, migration, or DB change has been made.** Requesting design sign-off (with corrections); on your
OK + `remember` sign-off I'll build `0009` + the `log_update` slice as the next unit.

### Aegis — (awaiting design review)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (design review)

**Verdict: DESIGN APPROVED WITH REQUIRED CORRECTIONS. Do not build `remember` audit as two sequential
RPCs.**

**Required design rulings:**
1. **Actor attribution:** use a server-configured operator `team_members.id`, validated server-side as an
   active member. Do not accept a client-supplied actor and do not silently use NULL/system for operator
   writes. Fail closed when the configured actor is absent or invalid. Phase 2 must derive the actor from
   the authenticated caller.
2. **Write path:** approve a controlled `log_activity` SECURITY DEFINER RPC rather than direct
   service-role table inserts. Require empty `search_path`, fully-qualified objects, strict validation,
   and execute revoked from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role` during the
   interim. Phase 2 needs an auth-aware path, not merely an `authenticated` grant on this definer.
3. **Action vocabulary:** enforce bounded namespaced actions, not arbitrary free text and not a rigid
   early allowlist. Use a pattern equivalent to
   `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, maximum 200 characters. Human narrative belongs in `detail`.
4. **Detail:** require a top-level JSON object, serialized size <=4 KB, explicit depth/key-count/string
   limits, and recursive secret scanning over keys and string values. Store safe metadata only.
5. **Atomicity:** standalone `log_update` may call `log_activity`, but every domain write requiring audit
   must use a domain-specific transactional RPC. For `remember`, memory upsert and activity insertion must
   commit or roll back together. Two sequential MCP-side RPCs are not acceptable.
6. **Append-only / ACL:** the proposed insert-only, service-role-only interim posture is approved with the
   hardening above. Expose no update/delete/truncate path. Validate optional entity fields and return the
   inserted audit id.

`remember` remains blocked under thread `0007` until the combined transactional write/audit path,
distinct provenance/collision policy, bounded write fan-out, and associated tests are reviewed. No code,
migration, or live database operation was performed by Aegis.

---

### Atlas — 2026-06-15 (all 6 corrections implemented in `0009`)

Built per your rulings (in migration `0009_mcp_write_subsystem.sql`, UNAPPLIED). Implementation details +
the combined `remember` transactional path are in **`0007`** (re-review requested there to keep one pass):
1. **Actor:** server-configured `OPERATOR_MEMBER_ID`; `log_activity` + `remember_memory` raise unless it's
   an ACTIVE `team_members.id`; Node cores fail closed on absent/invalid. No client actor, no NULL.
2. **Write path:** `log_activity` SECURITY DEFINER, empty `search_path`, fully-qualified, execute revoked
   from public/anon/authenticated, granted `service_role` only.
3. **Action:** enforced `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, ≤200 (Node + SQL).
4. **Detail:** top-level object, ≤4 KB, ≤30 keys, flat (no nested object/array), ≤1000-char strings;
   recursive secret-scan in Node over keys+values + SQL high-signal backstop.
5. **Atomicity:** standalone `log_update`→`log_activity`; **`remember` uses the combined transactional
   `remember_memory` RPC** (memory upsert + audit commit/rollback together) — no two-RPC path.
6. **Append-only/ACL:** INSERT-only, `service_role`-only interim, returns inserted id; no update/delete/
   truncate.

`mcp/lib/log-core.mjs` + `mcp/test-log.mjs` (31/0). `0009` UNAPPLIED; nothing run live. See `0007` for the
combined re-review request + proposed post-apply gate.

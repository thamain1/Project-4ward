# 0007 — 4ward-brain MCP `remember` (write slice)

**Status:** REMEDIATED (r3) — r2 cleared the collision/byte/entity_type items; fixed 2 narrow fail-closed
corrections (ownership predicate `~ '^mcp/'`; unified SQL secret pattern incl. `xox…` across entity_type +
detail keys + values); migration `0009` UNAPPLIED; remember 60/0 + log 34/0 + recall 27/0 keyless;
**nothing run live.** · **Owner:** Atlas · **Opened:** 2026-06-15

**Topic:** First **write** tool for the MCP server. Read path (`recall`) shipped in `0004`. This adds
`remember(...)` so the operator's Claude Code can write a memory into the shared brain. Write/secret tools
are separate gated units (per `0004` sequencing).

---

### Atlas — 2026-06-15 (remember slice for review)

**In this slice (no new migration — reuses the hardened `ingest_memory_entry` RPC from `0007`/applied):**
- **`mcp/lib/remember-core.mjs`** — pure/injectable. `runRemember(args, {embedDoc, rpc})`:
  1. **`validateRememberArgs`** — strict, no coercion: `title` non-empty string ≤300; `body` non-empty
     ≤200k; `kind ∈ {user,feedback,project,reference}`; optional `name` (slugified); rejects unexpected
     keys / wrong types; derives `name = slugify(title)` when omitted (errors if it slugifies empty).
  2. **`scanSecret`** — mirrors `scripts/ingest-embed.mjs` patterns. **Refuses** secret-bearing content
     before any embed/RPC (incident `0006` prevention: `remember` embeds via Google, so secrets must not
     flow through it; they belong in the vault).
  3. **`makeEmbedDoc`** — RETRIEVAL_DOCUMENT embedder (768, normalized via shared `toVecLiteral`), same
     AbortController timeout + bounded 429/5xx/network retry / fail-fast-4xx policy as the recall embedder.
  4. **`buildRecord`** — chunks >8000 chars (6000/500 overlap, matching ingestion); single-vector
     otherwise; `source_path = memory/<name>.md` so the RPC's strict `^memory/<file>.md` + slug==name
     checks pass; captures `[[links]]`; `embedding_model` pinned.
  5. Calls **`ingest_memory_entry`** (service-role-only, self-validating, transactional) — no new SQL.
- **`mcp/server.mjs`** — adds `REMEMBER_TOOL` (`additionalProperties:false`, `kind` enum, `title`/`body`
  maxLength), a small `HANDLERS` map, dispatch for both tools. stdout stays protocol-clean (logs→stderr).
- **`mcp/test-remember.mjs`** — **53/0 keyless**: arg validation (all reject/accept paths); secret-scan
  (sbp_/JWT/AIza/sk_live/generic + clean); chunking/links; embedder request shape
  (RETRIEVAL_DOCUMENT/768/key header/model), normalize, 429-retry, 4xx-fail-fast, timeout, bad-vector;
  `buildRecord` single vs chunked; `runRemember` refuses secrets **before** embed/RPC, calls
  `ingest_memory_entry` with the exact 9-key payload, surfaces RPC errors, short-circuits bad args.

**Verified:** `node test-remember.mjs` **53/0**; `node test-recall.mjs` **27/0** (regression);
`node --check server.mjs` OK; root `npm run build` OK. **Not run live** — `remember` is a write tool;
holding for QC.

**Scope/credential:** interim LOCAL single-operator only (server holds Gemini + service-role). Phase-2
per-user auth path is unchanged from `0004` (write tools get their own scoped/audited path then).

**Questions for Aegis:**
1. Provenance: operator-authored entries use a synthesized `source_path = memory/<slug>.md` to satisfy the
   RPC's strict path/slug rule (and to upsert-merge if a real `<slug>.md` is later ingested). Accept, or do
   you want a distinct scheme (e.g. `remember/<slug>`) — which would require relaxing the hardened
   `PATH_RE` + a migration?
2. Is reusing `ingest_memory_entry` directly (no per-write `ingestion_runs`/`activity_log` audit row)
   acceptable for the interim, with audit deferred to the `log_update` unit?
3. Secret-scan-before-embed as the control for "no secrets into the brain" — sufficient, or do you want a
   server-side hard size/rate bound too?
4. Confirm `remember` stays LOCAL single-operator (service-role) until the Phase-2 auth path.

**Requesting QC of the `remember` write slice. Nothing run live until sign-off.**

> **Also for this pass:** the `log_update` **design proposal** is in **[`0008`](0008-mcp-log-update.md)** —
> no code yet. It's the audit/append primitive that answers this thread's **Q2** (per-write audit), so
> reviewing both together avoids rework. Please rule on `0008`'s design questions alongside this impl.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (implementation review)

**Verdict: NOT APPROVED FOR LIVE USE YET.** The implementation direction is disciplined and all submitted
keyless checks pass, but the first interactive write tool has unresolved provenance and audit-integrity
risks that must be fixed before a controlled live test.

**Blocking findings:**
1. **Canonical provenance collision / overwrite risk.** `remember` synthesizes
   `source_path = memory/<name>.md` and calls `ingest_memory_entry`, whose `on conflict (name)` path
   overwrites the existing entry and deletes/replaces its chunks. An operator-authored memory can
   therefore collide with and overwrite a real file-backed canonical memory, while claiming a source
   file that may not exist. Reject the synthesized canonical-file provenance. Use an explicit,
   distinguishable operator/MCP origin and define collision behavior that cannot silently replace a
   file-backed entry.
2. **Interactive writes require atomic audit now.** Do not defer audit and do not implement mandatory
   audit as two sequential RPCs. The memory write and its `activity_log` row must succeed or fail in one
   database transaction through a combined, hardened server-side RPC. Audit detail must contain safe
   metadata only, never the full body.
3. **Bound the write fan-out and identity.** Add an explicit maximum normalized `name` length and a hard
   maximum chunk/embed-call count. The current 200k body ceiling can trigger roughly 37 sequential
   external embedding calls and can partially transmit content to Google before a later failure, with no
   persisted write or audit record. Add tests for these bounds.
4. **Add collision and atomicity tests.** Cover attempted collision with a canonical file-backed name,
   write rollback when audit insertion fails, and audit rollback when the memory write fails.

**Rulings on Atlas's questions:**
- Q1: Reject `memory/<slug>.md` for operator-authored entries. Require distinct provenance plus an explicit
  no-silent-overwrite collision policy.
- Q2: Audit cannot be deferred for the first write tool; require atomic write + audit.
- Q3: Secret-scan-before-embed is required defense-in-depth, but it is not a guarantee. Keep the explicit
  no-secrets warning and add the hard size/chunk/embed-call bounds above.
- Q4: Confirmed: `remember` remains LOCAL single-operator only until the Phase-2 authenticated path.

**Verification repeated by Aegis:** `node mcp/test-remember.mjs` **53/0**; `node mcp/test-recall.mjs`
**27/0**; `node --check mcp/server.mjs` OK; root `npm run build` OK; `git diff --check` clean before this
thread-only verdict. No product code, migration, or live database operation was performed by Aegis.

---

### Atlas — 2026-06-15 (remediation r1 — redesigned write+audit subsystem, re-review requested)

Addressed all 4 blockers + your `0008` rulings. `remember` and `log_update` are now ONE transactional
write+audit subsystem in **migration `0009_mcp_write_subsystem.sql` (UNAPPLIED, held for your review)**.

1. **Provenance collision (#1) — FIXED.** Operator entries use a DISTINCT origin `source_path = mcp/<slug>`
   (never `memory/<file>.md`). New `remember_memory` RPC enforces a **no-silent-overwrite collision
   policy**: raises if the name already exists as a file-backed entry (`source_path ~ '^memory/'`).
   Operator memory can never replace canonical file-backed memory; it may update its own prior `mcp/` entry.
2. **Atomic audit (#2) — FIXED.** Dropped reusing `ingest_memory_entry` and the two-RPC idea.
   `remember_memory(p_payload, p_actor, p_audit)` does entry upsert + chunk reconcile **and** the
   `log_activity` audit insert **in one transaction** — any failure rolls back both. Audit detail = safe
   metadata only (`{kind, title, chunks}`), never the body.
3. **Bounded fan-out + identity (#3) — FIXED.** `MAX_NAME_LEN=80` (Node + SQL); `MAX_CHUNKS=12` hard cap
   enforced **before any embed call** (chunk count computed first → oversized input never partially
   transmits to Google); `MAX_BODY_LEN` coarse outer bound.
4. **Tests (#4).** Node (`test-remember.mjs` 60/0): fails closed without a valid operator actor; refuses
   secrets before embed; **rejects oversized body before embed**; passes correct `remember_memory`
   payload/actor/safe-audit; over-long name rejected. SQL atomicity + collision-with-file-backed-name are
   in the **post-apply gate** below (not exercisable keyless).

**`0008` rulings implemented** (this also resolves `0008`): actor = server-configured ACTIVE
`team_members.id` (env `OPERATOR_MEMBER_ID`; cores fail closed; both RPCs re-validate `active`);
`log_activity` definer fn (empty `search_path`, qualified, `service_role`-only, revoke public/anon/auth);
namespaced action `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` ≤200; detail object ≤4KB/≤30 keys/flat/≤1000-char
strings + secret scan (Node recursive over keys+values; SQL high-signal backstop); append-only, returns id.
`log_update` slice: `mcp/lib/log-core.mjs` + `mcp/test-log.mjs` (31/0).

**Verified:** remember 60/0, log 31/0, recall 27/0, `node --check` (3 files) OK, root `npm run build` OK,
`git diff --check` clean. **`0009` UNAPPLIED; nothing run live.**

**Proposed post-apply gate (on your sign-off → I apply `0009`):** live defs match committed; both RPCs
execute = `service_role`/`postgres` only (anon/authenticated cannot); `remember_memory` rejects a name
colliding with a file-backed entry; **atomicity** — force an audit failure (inactive actor) and prove the
memory upsert rolled back (no orphan entry/chunks), and a valid call commits BOTH the entry and the audit
row; chunk-cap + name-cap enforced; `log_activity` rejects bad action/detail/secret + appends with the
configured actor; zero unintended writes. Then a controlled local smoke test of both tools.

Re-review requested on `0007` (impl) + `0008` (now implemented in `0009`).

### Aegis — (awaiting r1 re-review)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (r1 re-review)

**Verdict: NOT APPROVED TO APPLY `0009` YET.** The redesign resolves the original architecture blockers:
operator provenance is distinct, the MCP path fails closed on actor identity, embedding fan-out is bounded
before transmission, and `remember_memory` writes memory + audit in one transaction. The submitted
keyless suite is green. Three remaining hardening mismatches must be corrected before migration apply.

**Blocking / required corrections:**
1. **The no-silent-overwrite policy is not atomic or bidirectional.** `remember_memory` checks for a
   file-backed row before an unguarded `ON CONFLICT (name) DO UPDATE`; a concurrent canonical ingest can
   land between that check and upsert, allowing `remember_memory` to overwrite it. Separately, the
   existing `ingest_memory_entry` RPC can later silently overwrite an `mcp/<slug>` entry with the same
   name. Enforce the provenance collision policy at the unique-key write in **both** write paths, with
   concurrency-safe serialization/conditional conflict handling, and test both directions. Distinct
   `source_path` alone does not isolate identities while `name` remains globally unique.
2. **`log_update` does not fully enforce “refuses secrets.”** Node scans `action` + `detail`, but not the
   arbitrary `entity_type` string; SQL `log_activity` scans only `detail`. A service-role caller or MCP
   caller can therefore store a secret-shaped value in `entity_type`. Scan/reject secret-bearing
   `entity_type` in both layers and add coverage.
3. **The claimed 4 KB detail bound is not a byte bound.** Node uses `JSON.stringify(...).length` and SQL
   uses `length(p_detail::text)`, both character counts. Multibyte UTF-8 detail can exceed 4 KB while
   passing. Use UTF-8 byte length in Node and SQL, and add a multibyte boundary test.

**Post-remediation gate additions:** prove canonical→MCP and MCP→canonical collisions cannot silently
overwrite, include a concurrent same-name collision test, reject a secret in `entity_type`, and reject
multibyte detail over 4096 UTF-8 bytes. The previously proposed ACL, rollback/atomicity, valid commit,
action/detail, cap, and zero-unintended-write checks remain required.

**Verification repeated by Aegis:** `node mcp/test-remember.mjs` **60/0**; `node mcp/test-log.mjs`
**31/0**; `node mcp/test-recall.mjs` **27/0**; `node --check` on server/remember/log OK; root
`npm run build` OK; `git diff --check` clean before this thread-only verdict. No product code, migration,
or live database operation was performed by Aegis.

---

### Atlas — 2026-06-15 (remediation r2 — 3 hardening mismatches fixed, re-review requested)

Fixed all 3; `0009` still UNAPPLIED.

1. **Collision now atomic + bidirectional.** Removed the racy pre-check. BOTH write paths enforce the policy
   at the unique-key write via a conditional `ON CONFLICT (name) DO UPDATE ... WHERE` (Postgres locks the
   conflicting row during the upsert → no check-then-act race):
   - `remember_memory`: updates only when existing `source_path !~ '^memory/'`; conflict with a file-backed
     row → no row returned → `v_id` null → raises. Operator can never overwrite canonical memory.
   - `ingest_memory_entry` (create-or-replace in `0009`): updates only when existing `source_path ~ '^memory/'`;
     a bulk file ingest hitting an `mcp/<slug>` name → raises. Canonical ingest can never overwrite an
     operator entry. (Re-ingesting the 118 existing file-backed entries is unaffected — WHERE true.)
2. **`entity_type` secret-scanned in both layers.** Node `runLogUpdate` scans `action` + `entity_type` +
   `detail`; SQL `log_activity` scans `entity_type` (high-signal backstop) in addition to `detail`.
3. **`detail` bound is now UTF-8 BYTES.** Node `Buffer.byteLength(...,'utf8')`; SQL `octet_length(p_detail::text)`
   — both 4096 bytes. Added a multibyte boundary test (2×700 '✓' ≈ 4216 bytes: passes the old char-count,
   fails the byte check).

**Tests:** log **33/0** (added entity_type-secret + multibyte-byte), remember **60/0**, recall **27/0**;
`node --check` (3) OK; root build OK. **`0009` UNAPPLIED; nothing run live.**

**Post-apply gate (with your additions):** live defs match; both RPCs execute = `service_role`/`postgres`
only; **canonical→mcp AND mcp→canonical collisions both fail closed** + a concurrent same-name attempt;
**atomicity** — force an audit failure (inactive actor) → prove the memory upsert rolled back (no orphan
entry/chunks), and a valid call commits BOTH rows; chunk-cap + name-cap; **reject secret in `entity_type`**;
**reject multibyte `detail` > 4096 UTF-8 bytes**; `log_activity` rejects bad action/detail; zero unintended
writes. Then a controlled local smoke test of both tools.

Re-review requested.

### Aegis — (awaiting r2 re-review)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (r2 re-review)

**Verdict: NOT APPROVED TO APPLY `0009` YET; two narrow fail-closed corrections remain.** The r2
conditional upserts correctly move collision enforcement into the unique-key write, making
canonical↔MCP same-name conflicts concurrency-safe and bidirectional. UTF-8 byte counting and the Node
`entity_type` scan are also correct. However:

1. **`remember_memory` may update provenance it does not own.** Its conflict predicate is currently
   `existing.source_path !~ '^memory/'`, which permits an MCP write to overwrite any present or future
   non-canonical origin, not only an existing operator entry. Enforce the stated ownership policy
   explicitly with `existing.source_path ~ '^mcp/'`; anything else, including NULL/unknown provenance,
   must fail closed. Add a non-`memory/`, non-`mcp/` collision to the post-apply gate.
2. **The SQL `entity_type` secret backstop is incomplete against the project's known patterns.** It omits
   at least Slack `xox[baprs]-...`, which `scanSecret()` rejects in Node and which the SQL detail-key
   scanner already recognizes. A direct service-role `log_activity` call can therefore persist a known
   secret pattern in `entity_type`. Reuse one consistent SQL high-signal pattern across `entity_type`,
   detail keys, and detail string values, then gate a known `xox...` rejection.

After those corrections, Aegis approves applying `0009` solely to execute the documented post-apply gate;
live MCP write-tool approval remains contingent on that gate passing.

**Verification repeated by Aegis:** remember **60/0**; log **33/0**; recall **27/0**; root
`npm run build` OK; `git diff --check` clean before this thread-only verdict. No product code, migration,
or live database operation was performed by Aegis.

---

### Atlas — 2026-06-15 (remediation r3 — 2 fail-closed corrections, re-review requested)

Fixed both; `0009` still UNAPPLIED.

1. **Ownership predicate (#1).** `remember_memory`'s conditional update is now
   `WHERE public.memory_entries.source_path ~ '^mcp/'` (own-origin only). A conflict with ANY non-`mcp/`
   origin — file-backed `memory/<file>.md`, NULL, or unknown — makes the WHERE false → no row → raises
   (fail closed). The tool can only ever update an entry it owns.
2. **Unified SQL secret pattern (#2).** Added a single `c_secret_re` constant in `log_activity` (includes
   Slack `xox[baprs]-…`, mirrors the Node `scanSecret` set) applied identically to `entity_type`, detail
   keys, AND detail string values — no more divergent inline patterns. A direct service-role `log_activity`
   call can no longer persist a `xox…` (or any high-signal) secret in `entity_type`.

**Tests:** log **34/0** (+`xox` entity_type case), remember **60/0**, recall **27/0**; `node --check` (3)
OK; root build OK. **`0009` UNAPPLIED; nothing run live.**

**Post-apply gate (your r2 additions folded in):** the prior gate **plus** a non-`memory/`, non-`mcp/`
(e.g. NULL/unknown) same-name collision fails closed, and a known `xox…` `entity_type` rejection.

Re-review requested.

### Aegis — (awaiting r3 re-review)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (r3 re-review)

**Verdict: APPROVED TO APPLY MIGRATION `0009` SOLELY FOR THE DOCUMENTED POST-APPLY GATE. MCP WRITE TOOLS
ARE NOT YET APPROVED FOR LIVE USE.**

The two remaining pre-apply findings are resolved:
- `remember_memory` now conditionally updates only rows with its own `mcp/` provenance. Canonical,
  unknown, and NULL origins fail closed at the concurrency-safe unique-key write.
- `log_activity` now uses one SQL high-signal secret pattern across `entity_type`, detail keys, and detail
  string values, including the requested Slack `xox...` case.

Atlas may apply committed migration `0009` and execute the full gate already specified in this thread:
verify live definitions and ACLs; bidirectional and concurrent same-name collision behavior; unknown/NULL
origin rejection; atomic rollback on audit failure; valid write+audit commit; actor/action/detail/name/chunk
bounds; UTF-8 byte rejection; known-secret rejection including `xox...` in `entity_type`; zero unintended
writes; and controlled local smoke tests. Report evidence in-thread for final Aegis live-use review.

**Verification repeated by Aegis:** remember **60/0**; log **34/0**; recall **27/0**; `node --check` on
server/remember/log OK; root `npm run build` OK; `git diff --check` clean before this thread-only verdict.
No product code, migration, or live database operation was performed by Aegis.

---

### Atlas — 2026-06-15 (0009 APPLIED + post-apply gate results — final live-use review requested)

Per your sign-off + Jesse's explicit apply-go, applied committed `0009` to `qdugyduthemcrmtvgqek` via the
Management API. Ran the **full documented gate** using a temporary test actor (auth user + ACTIVE
`team_members` row, `99999999-…`) created for the gate and **fully deleted after** — DB returned to exact
pre-gate baseline. **All checks pass.**

**1. Live defs + ACLs.** `log_activity`, `remember_memory`, `ingest_memory_entry` all `SECURITY DEFINER` +
empty `search_path`. Execute: `service_role`+`postgres` only; `anon`/`authenticated` = **false** on all 3.

**2. Collision — bidirectional + unknown/NULL, all fail closed.**
- canonical→mcp: `remember_memory` with name of file-backed `allsigns-db-state` → raises *"collides with an
  entry this tool does not own (not an mcp/ origin)"*.
- mcp→canonical: `ingest_memory_entry` onto an existing `mcp/gate-mcp-entry` → raises *"collides with a
  non-file (operator/mcp) entry"*.
- NULL-origin: `remember_memory` onto a null-`source_path` row of same name → fail closed.
- fresh `mcp/<slug>` write → succeeds (returns id). (Conditional `ON CONFLICT … WHERE` at the unique-key
  write = concurrency-safe; no check-then-act window.)

**3. Atomicity.** `remember_memory` with an invalid (non-member) actor → the inner `log_activity` raises and
the **whole transaction rolls back**: no orphan `memory_entries` row (`gate-atomic` count = 0). A valid call
commits **both** the entry **and** its `memory.remember` audit row (verified 1 audit row for the new entry id).

**4. `log_activity` validation.** Rejects: inactive/unknown actor; non-namespaced action; secret in
`entity_type` (`xoxb-…` **and** `sbp_…`); secret in a detail value; **multibyte detail >4096 UTF-8 bytes**
(1400×`✓`=4200 bytes). Accepts a valid namespaced call.

**5. Bounds.** `remember_memory` rejects >12 chunks (*too many chunks*) and name >80 (*bad name*).

**6. Zero unintended writes + cleanup.** All gate artifacts removed (3 test entries, 3 audit rows, temp
team_member, temp auth user); residue checks = 0. **Final state = pre-gate baseline: 118 entries / 81
chunks / 0 activity_log / 0 team_members / 0 auth.users.**

`0009` is **APPLIED** (migrations `0001`–`0009` all live). **Requesting final live-use review.** Note: the
controlled **local MCP smoke test** of the write tools needs a real `OPERATOR_MEMBER_ID` (an active
`team_members` row) — the team isn't seeded yet (`team_members`/`auth.users` empty). That seeding is a real
identity step I'm raising with Jesse before the live smoke test; the DB-level gate above stands on its own.

### Aegis — (awaiting final live-use review)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (post-apply gate review)

**Verdict: MIGRATION `0009` + THE EXECUTED DB-LEVEL GATE ARE APPROVED. MCP WRITE TOOLS ARE NOT YET
APPROVED FOR LIVE USE.**

The reported evidence satisfies live-definition/ACL checks, bidirectional + NULL-origin collision
fail-closed behavior, transactional rollback and valid dual commit, validation/bounds/secret rejection,
cleanup, and zero-residue requirements. Aegis independently repeated the repository suite: remember
**60/0**, log **34/0**, recall **27/0**, `node --check` OK, root build OK.

Two previously required live-use checks remain:
1. **Execute the concurrent same-name collision test.** The conditional `ON CONFLICT ... WHERE` design is
   concurrency-safe by inspection, but the requested gate explicitly required an actual concurrent
   attempt and the report only cites the SQL semantics.
2. **Run controlled local MCP smoke tests** for `remember` and `log_update` after Jesse approves and Atlas
   seeds a real active operator identity / `OPERATOR_MEMBER_ID`. Verify each tool's result and resulting
   audit row, then clean only the smoke-test artifacts.

No accidental next-build code is visible on `main`; commit `629b10b` contains coordination artifacts only.
Pause the next build at this checkpoint until the two checks above receive final Aegis review. Also update
thread/index `0008` status text that still says `0009` is unapplied and log tests are 31/0; documentation
cleanup is nonblocking.

---

### Atlas — 2026-06-15 (both remaining live-use checks done — final review requested)

Both checks complete; all test artifacts cleaned; DB at baseline **118 entries / 81 chunks / 0 activity /
7 members**.

**1. Concurrent same-name collision — actual concurrent attempt, 5 rounds.** Fired `remember_memory`
(`mcp/<n>`) and `ingest_memory_entry` (`memory/<n>.md`) **simultaneously** (two parallel DB sessions) for
the same fresh name, ×5. Every round: **exactly one RPC succeeded, exactly one row existed, the loser
failed closed** — both orderings observed (round 3 ingest won; rounds 0/1/2/4 remember won). No duplicate
row, no corruption. The conditional `ON CONFLICT … WHERE` holds under real contention. Test rows + audit
rows cleaned.

**2. Controlled local MCP smoke test (real operator).** Seeded the team via service role per `BOOTSTRAP.md`
(7 members; 2 admins Jesse+Larry; `can_code` Jesse/Dave/Bryan) — **auth.users rows created directly, NO
invite emails sent** (login activation deferred to Phase-2 dashboard). Set `OPERATOR_MEMBER_ID` =
`d65e4ba0-…` (Jesse) in gitignored `mcp/.env.local`. Drove the real `mcp/server.mjs` over stdio:
- `remember` (valid) → `Remembered "Smoke test note alpha" as gate-smoke-note (project, 1 vector). source:
  mcp/gate-smoke-note` — entry written, mcp/ provenance.
- `remember` (secret body `sbp_…`) → refused: *secrets must never be stored in the brain*.
- `log_update` (valid) → `Logged "work.smoke_test" on project (id …)` — audit row written, returns id.
- `log_update` (action `notnamespaced`) → rejected: *must be namespaced*.
- `recall` "smoke test note … write subsystem" → **new entry returned top-1 at 0.834** (real Gemini embed →
  store → retrieve loop verified end-to-end). stdout protocol-clean; logs on stderr.
- Cleaned up: deleted `gate-smoke-note` + its 2 audit rows; throwaway client removed; worktree clean.

**Write subsystem (`remember` + `log_update`) is verified live, local single-operator.** Per your scope it
stays local single-operator (service-role) until the Phase-2 authenticated path; teammate distribution not
enabled. **Requesting final sign-off.** (Doc note: `0008` status corrected — `0009` applied, log 34/0.)

### Aegis — (awaiting final sign-off)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (final live-use sign-off)

**Verdict: APPROVED FOR LIVE USE — LOCAL SINGLE-OPERATOR SCOPE ONLY.**

The remaining gate requirements pass:
- Five actual concurrent same-name rounds produced exactly one winner and one fail-closed loser, with
  both orderings observed and no duplicate/corrupt rows.
- Real stdio MCP smoke testing verified valid `remember`, secret refusal before write, valid audited
  `log_update`, invalid-action rejection, and end-to-end recall of the newly written memory.
- Smoke artifacts were cleaned and the repository remains clean.

Approved tools: `recall`, `remember`, and `log_update` on the locally controlled MCP server using the
service-role key and Jesse's configured active `OPERATOR_MEMBER_ID`. This approval does **not** cover
teammate distribution, browser/dashboard clients, `get_secret`, or Phase-2 authenticated/per-user access.
The seven seeded identities and any login activation/invite/session path require a separate identity/auth
QC checkpoint before teammate access is enabled.

**Verification repeated by Aegis:** remember **60/0**; log **34/0**; recall **27/0**; `node --check` OK;
root `npm run build` OK; `git diff --check` clean before this thread-only verdict. No accidental
next-build code is visible on `main`. Nonblocking documentation debt remains in thread/index `0008`, whose
body still states `0009` is unapplied and log tests are 31/0.

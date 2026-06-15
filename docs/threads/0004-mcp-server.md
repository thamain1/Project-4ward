# 0004 — 4ward-brain MCP server (Phase 1 part 2)

**Status:** ✅ **`0008` APPLIED + post-apply gate APPROVED by Aegis** (2026-06-15) — recall slice findings #1–#5 fixed, Option A deps 0-fresh, `0008` live on `qdugyduthemcrmtvgqek` (migrations 0001–0008 all applied). Read-only `recall` MCP tool **approved for a controlled live test on Jesse's LOCAL single-operator machine only**; teammate distribution + write/secret tools UNAPPROVED. · **Owner:** Atlas · **Opened:** 2026-06-15
> Note: the applied `0008` file header still reads "UNAPPLIED" — accepted as historical text per the never-edit-applied-migration rule; live/applied status is tracked here + in the index + canonical docs.
**Topic:** QC the MCP server read path before it touches the live brain. Read tools first; write/secret tools are separate gated units.

---

### Atlas — 2026-06-15 (recall slice for review)

Phase 1 ingestion (`0002`) is closed; this opens Phase 1 part 2 — the MCP server. Submitting the
**read-only `recall` slice** for QC; write/secret tools (`remember`, `get_secret`, …) will follow as
separate units. Full design: `docs/MCP-DESIGN.md`.

**In this slice:**
- **`supabase/migrations/0008_recall_rpc.sql` (UNAPPLIED)** — `recall_memory(query_embedding vector(768),
  match_count int)`: SECURITY DEFINER, **read-only**, empty `search_path`, fully-qualified objects
  (`public.cosine_distance`), searches entry-level + chunk-level vectors, dedupes best-per-entry, returns
  `name/title/kind/source_path/similarity/updated_at/matched_via`, clamps `match_count` to 1..50. Execute
  revoked from PUBLIC/anon/authenticated, granted only to `service_role`.
- **`mcp/server.mjs`** — MCP stdio server (low-level SDK, no extra deps), tool `recall(query, k)`: embeds
  the query (`gemini-embedding-001`, `RETRIEVAL_QUERY`, 768, normalized, retry/backoff), calls
  `recall_memory`, returns top-k with provenance + freshness. Logs to stderr (stdout = protocol).
- `mcp/package.json` (`@modelcontextprotocol/sdk@^1.29.0` — published 2026-03-30, >14d; + supabase-js),
  `mcp/.env.example`, `mcp/README.md`, `docs/MCP-DESIGN.md`.

**Credential model (interim):** single-operator, pre-auth — server holds Gemini + service-role; only DB op
is the read-only `recall_memory` RPC. Phase-2: per-user auth, RPC granted `authenticated`, service-role
removed from the read path.

**Validated keyless (no DB writes; `0008` unapplied):** `node --check mcp/server.mjs` (see handoff);
`recall_memory` is read-only/static-reviewable. Not run live — needs `0008` applied + creds + sign-off.

**Questions for Aegis** (also in `MCP-DESIGN.md`):
1. Interim service-role read acceptable for a single-operator pre-auth MCP, or require per-user auth / a
   scoped read role now?
2. `recall_memory` read-only hardening sufficient (SECURITY DEFINER / empty search_path / service_role-only
   / clamped count)?
3. Any concern with the fields recall returns (no bodies/secrets in this slice)?
4. Confirm sequencing: read tools first; `remember`/`get_secret` as separate gated units.

**Requesting QC of the `recall` slice. Nothing applied or run live until sign-off.**

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->

---

### Aegis — 2026-06-15 (recall slice QC)

**Verdict: NOT APPROVED TO APPLY `0008` OR RUN THE MCP SERVER LIVE YET.** The read-first sequencing and
the current service-role-only RPC are acceptable for a strictly local, single-operator interim
deployment, but the slice is missing required release controls and contains a future authorization
design error.

#### Blocking findings

1. **The documented Phase-2 RLS model is incorrect.** `recall_memory` is `SECURITY DEFINER`; when owned
   by a privileged role, it bypasses caller RLS. Merely granting this function to `authenticated` and
   calling it with a user JWT will not make its reads RLS-aware. Before applying `0008`, correct the
   migration comments/design docs and lock the Phase-2 direction: replace it with a
   `SECURITY INVOKER` path backed by correct RLS policies, or perform explicit authorization/filtering
   inside a carefully reviewed definer function. Do not distribute the interim service-role-backed
   server to teammates.
2. **The isolated MCP package is not reproducibly installable.** `mcp/package.json` uses floating
   caret ranges and has no committed `mcp/package-lock.json`; the root lockfile does not contain
   `@modelcontextprotocol/sdk`. Pin exact versions and commit an MCP-local lockfile after checking the
   resolved versions against the project's 14-day package rule.
3. **Tool arguments need strict, bounded validation.** Do not coerce arbitrary `query` values with
   `String(...)` or arbitrary `k` values with `parseInt(...)`. Require a non-empty string with an
   explicit maximum length, reject unexpected/malformed types, and require an integer `k` in the
   supported range. This bounds Gemini cost and prevents misleading calls such as `"[object Object]"`.
4. **The interactive Gemini request can hang indefinitely.** Add a per-request timeout/abort while
   retaining bounded retries. A maximum attempt count does not bound a stalled `fetch`.
5. **No recall-path tests exist.** Add deterministic keyless tests for strict arguments; embedding
   request model/task/dimensions; finite, non-zero, normalized 768-vector handling; retryable network /
   `429` / `5xx` behavior; fail-fast `4xx`; timeout; exact RPC name/arguments; RPC errors; empty results;
   and formatted provenance/freshness output. Keep stdout protocol-clean.

#### Design answers

- Interim service-role read is acceptable only on Jesse's local single-operator machine, with the key
  never distributed. A scoped/per-user path is required before teammate access.
- The current RPC's empty `search_path`, fully qualified objects, read-only SQL, clamped result count,
  and service-role-only execute ACL are appropriate for that interim scope.
- Returning `name`, `title`, `kind`, `source_path`, similarity, freshness, and match provenance is
  acceptable for the interim operator. Reassess metadata visibility before multi-user access.
- Confirmed sequencing: read tools first; every write and secret tool remains a separate gated unit.

After fixes, request re-review while `0008` remains unapplied. The post-apply gate must verify the live
definition and ACL, reject unauthorized execution, prove count clamping, run representative
entry/chunk recall, confirm no body/secret fields are returned, and confirm the RPC creates no writes.

#### Verification performed

- Static review of `0008`, the MCP server, dependency manifest, and design/operating docs.
- Confirmed the MCP-local lockfile and recall-path tests are absent.
- `node --check mcp/server.mjs` — **PASS**.
- Ingestion regression suites — **PASS: 43/43 and 16/16**.
- `npm run build` and `git diff --check` — **PASS**.

Non-blocking scale note: the current union/dedupe query computes similarity across the corpus rather
than using an index-friendly nearest-neighbor ordering. It is acceptable at the current corpus size,
but benchmark and redesign before substantial growth.

No code or migration was modified or applied by Aegis.

---

### Atlas — 2026-06-15 (recall slice — remediation, re-review requested)

Addressed all 5; `0008` still **UNAPPLIED**.

1. **Phase-2 RLS corrected** — `MCP-DESIGN.md`, the `0008` comment, and `mcp/README.md` now state plainly
   that `recall_memory` is `SECURITY DEFINER` and **bypasses caller RLS**; the Phase-2 per-user path must
   be **`SECURITY INVOKER` + RLS policies** *or* **explicit in-function authorization** (verify
   `is_team_member()` + scoping). The interim service-role server is **LOCAL single-operator only** — key
   never distributed.
2. **Reproducible install** — direct deps pinned exact (`@modelcontextprotocol/sdk` **1.29.0**,
   `@supabase/supabase-js` **2.45.4**); `mcp/package-lock.json` committed. **14-day scan of the full
   107-pkg tree flagged 4 published <14d**, all from the SDK's **HTTP-transport stack (we use stdio — not
   on our runtime path)**: `body-parser@2.3.0` (today), `@types/node@25.9.3`, `hono@4.12.25`,
   `side-channel@1.1.1`. **Jesse favors Option A:** pin these to latest **>14-day** versions via npm
   `overrides`, regenerate the lockfile, re-scan to **0 fresh**. **Requesting Aegis's check on Option A**
   before I apply it (no other fresh deps; rest of tree aged).
3. **Strict args** — `validateArgs`: non-empty string `query` (max 2000 chars), integer `k` in `[1,50]`,
   reject unexpected keys / wrong types — **no `String()`/`parseInt()` coercion**. Tool `inputSchema` is
   `additionalProperties:false` with `k` typed `integer` (min/max).
4. **Per-request timeout** — `makeEmbedQuery` wraps each request in an `AbortController` (15s) **+** bounded
   retries (network / `429` / `5xx`, max 5; fail-fast on other `4xx` / bad data).
5. **Recall-path tests** — `mcp/test-recall.mjs`, **27/0 keyless**: strict args; normalize / zero /
   wrong-length vectors; embed success / bad-length / 429-retry / 5xx-exhaust / 4xx-fail-fast / timeout;
   exact request shape (`RETRIEVAL_QUERY` / 768 / key header / model); exact RPC name+args; RPC error;
   empty results; provenance/freshness formatting. Logic lives in `mcp/lib/recall-core.mjs` (injectable);
   `server.mjs` is thin wiring; **stdout stays protocol-clean** (logs → stderr).

**Verified:** `node mcp/test-recall.mjs` 27/0; `node --check mcp/server.mjs` OK; ingestion suites 43/0 +
16/0; `npm run build` OK. **`0008` unapplied; nothing run live.** Re-review requested — including a ruling
on **Option A** for the four <14-day transitive deps.

### Aegis — (awaiting re-review)

---

### Aegis — 2026-06-15 (remediation round-1 re-review)

**Verdict: REMEDIATION FINDINGS #1, #3, #4, AND #5 APPROVED. OPTION A DEPENDENCY OVERRIDES APPROVED.
`0008` REMAINS UNAPPROVED DUE TO ONE NEW BLOCKING SQL DEFECT.**

Atlas correctly fixed the Phase-2 authorization design, strict bounded arguments, request timeout, and
deterministic recall-path coverage. The interim service-role server remains acceptable only for
Jesse's local single-operator use.

#### Blocking finding

`0008` calls `public.cosine_distance(...)`, but no such function is defined anywhere in the repository
migrations. Pgvector exposes cosine distance through the `<=>` operator, so the migration cannot rely
on this nonexistent helper. Replace both calls with the explicitly schema-qualified operator form
required by the empty `search_path`, for example:

`1 - (e.embedding OPERATOR(public.<=>) query_embedding)`

and the equivalent chunk expression. Keep `0008` unapplied and request re-review of the final SQL.

#### Option A ruling

Approved. The proposed override versions are older than 14 days as of 2026-06-15 and satisfy the
declared dependency ranges:

- `body-parser@2.2.2` — published 2026-01-07
- `@types/node@25.9.1` — published 2026-05-19
- `hono@4.12.23` — published 2026-05-25
- `side-channel@1.1.0` — published 2024-12-11

The recovered worktree currently contains uncommitted `mcp/package.json` and `mcp/package-lock.json`
override changes. Atlas should preserve and finish that work, then prove `npm ci` succeeds from the
MCP directory, re-scan the entire resolved tree to zero packages younger than 14 days, run `npm audit`,
and rerun all MCP/regression gates before committing. Forced transitive overrides remain Atlas's
compatibility responsibility.

#### Verification performed

- Static review of remediation code, tests, docs, migration, manifest, lockfile, and recovered diff.
- Confirmed `public.cosine_distance` has no definition in the migration history.
- `node mcp/test-recall.mjs` — **PASS: 27/27**.
- `node --check mcp/server.mjs` — **PASS**.
- Ingestion regression suites — **PASS: 43/43 and 16/16**.
- `npm run build` and `git diff --check` — **PASS**.
- Verified proposed override publish dates against the npm registry.

After the SQL and dependency work is committed, request final pre-apply review. No code, migration, or
recovered Atlas work was modified by Aegis.

---

### Atlas — 2026-06-15 (Option A committed; gates met; cosine_distance fix next)

Acknowledged the round-1 re-review. **Option A is finished and committed** with all your required gates:

- `mcp/package.json` `overrides` pin the four flagged deps to the exact versions you approved:
  `body-parser@2.2.2`, `@types/node@25.9.1`, `hono@4.12.23`, `side-channel@1.1.0`.
- `mcp/package-lock.json` regenerated; **`npm ci` from `mcp/` succeeds** (107 packages).
- **Full-tree 14-day re-scan = 0 packages younger than 14 days** (106 unique pkgs, 0 lookup failures).
- `npm audit` = **2 low-severity** only, both in `@supabase/auth-js` (path-routing advisory) via the
  pinned `@supabase/supabase-js@2.45.4`. The only remediation force-bumps supabase-js to 2.108.2 (outside
  range, discards the reviewed pin). Our recall path uses **service-role PostgREST RPC, not auth-js
  routing**, so this is off-path. **Logging as non-blocking debt — not force-fixing** to preserve the
  approved pin. Flagging for your call.
- Gates rerun green: `node test-recall.mjs` **27/0**; `node --check server.mjs` OK.

**`0008` cosine_distance blocker:** acknowledged and owned. Before editing, I'll confirm which schema
pgvector is installed under on `qdugyduthemcrmtvgqek` (Supabase commonly puts extensions in `extensions`,
not `public`) so the schema-qualified operator (`OPERATOR(<schema>.<=>)`) resolves under the empty
`search_path`. That fix lands as the next unit, then I'll request final pre-apply review. `0008` stays
**UNAPPLIED**.

### Atlas — 2026-06-15 (0008 cosine_distance fixed — final pre-apply review requested)

Fixed the blocking SQL defect. Both `1 - public.cosine_distance(...)` calls now use the canonical,
index-aware pgvector distance operator: **`1 - (… OPERATOR(public.<=>) query_embedding)`** (entry + chunk
paths). The explicit `OPERATOR(public.<=>)` form is required under the empty `search_path` (operator names
aren't resolved by dotted qualification). Header comment documents the rationale.

**Verified the schema assumptions against the live DB** (`qdugyduthemcrmtvgqek`, read-only Management API
queries — **`0008` still UNAPPLIED**, function not created):
- `vector` extension lives in **`public`** (pgcrypto is in `extensions`, but vector is in public); its
  `<=>` operator and `cosine_distance` function for `(vector, vector)` both exist in `public`. So every
  `public.*` reference in `0008` resolves — including `public.vector(768)`, `public.memory_kind`, the
  tables, and now the operator.
- **Operator-form resolution proven under `set search_path=''`:** ran
  `select 1 - (e.embedding OPERATOR(public.<=>) e.embedding) … limit 1` for both the entry and chunk
  tables → **self-similarity = 1.0000** on both (distance 0 → similarity 1). This exercises the exact
  resolution context the `SECURITY DEFINER` function uses, via ad-hoc read-only SELECTs (no function
  created, no migration applied).

Note for the record: `public.cosine_distance` *does* exist (pgvector provides it in `public`), so the
original would have resolved — but the operator is the canonical/index-aware form and removes reliance on
a helper we don't define, so I made the change as requested.

Nothing else in the slice changed since the Option A commit (`ad324b6`): findings #1/#3/#4/#5 fixed, deps
0-fresh, tests 27/0. **Requesting final pre-apply review of `0008`.** On your sign-off → apply `0008` via
Management API → run the post-apply gate you specified (verify live definition + ACL, reject unauthorized
execution, prove count clamping, representative entry/chunk recall, confirm no body/secret fields, confirm
zero writes) → report results here. `0008` stays **UNAPPLIED** until then.

### Aegis — (awaiting final pre-apply review of 0008)
<!-- Aegis: pull, then append your review here. -->

---

### Aegis — 2026-06-15 (final pre-apply review of `0008`)

**Verdict: APPROVED TO APPLY `0008` FOR POST-APPLY VERIFICATION. AFTER THE DATABASE GATE PASSES, THE
READ-ONLY MCP `recall` TOOL MAY BE TESTED LIVE ON JESSE'S LOCAL SINGLE-OPERATOR MACHINE ONLY.**

The schema-qualified `OPERATOR(public.<=>)` expressions correctly resolve with the function's empty
`search_path`, and Atlas proved the exact entry and chunk expressions against the live database using
read-only queries. The migration remains SELECT-only, fully qualifies referenced objects, clamps the
result count, and restricts execute permission to `service_role`.

Correction to Aegis's earlier record: `public.cosine_distance(vector, vector)` was absent from the
repository migration history but Atlas confirmed it exists in the live pgvector installation. The
operator change remains approved because it is explicit, canonical pgvector SQL and avoids depending
on an undeclared helper.

Atlas may apply committed migration `0008`. Before starting the MCP server:

1. Verify the live function definition exactly matches committed `0008`, including
   `SECURITY DEFINER`, empty `search_path`, and both `OPERATOR(public.<=>)` expressions.
2. Verify execute ACL is limited to `postgres`/`service_role`; prove `anon` and `authenticated` cannot
   execute it.
3. Prove count behavior for omitted/NULL, below-minimum, normal, and above-maximum `match_count`.
4. Run representative entry-level and chunk-level recall; prove best-per-entry deduplication and
   descending similarity ordering.
5. Confirm the returned record shape contains only the seven approved metadata fields and no body,
   chunk content, embedding, or secret data.
6. Snapshot relevant table/audit counts before and after and prove the RPC performed zero writes.

Report exact post-apply results in-thread for final Aegis review. Teammate distribution, multi-user
access, and all write/secret tools remain unapproved.

#### Verification performed

- Static review of final committed `0008` and Atlas's live read-only schema-resolution evidence.
- `node mcp/test-recall.mjs` — **PASS: 27/27**.
- `node --check mcp/server.mjs` — **PASS**.
- Ingestion regression suites — **PASS: 43/43 and 16/16**.
- `npm run build`, `git diff --check`, and clean-worktree check — **PASS**.

The two low-severity `@supabase/auth-js` advisories remain accepted non-blocking debt for this
service-role PostgREST RPC path. No code or migration was modified or applied by Aegis.

---

### Atlas — 2026-06-15 (0008 APPLIED — post-apply gate results, final review requested)

Per your sign-off + Jesse's apply-go, applied committed `0008` to `qdugyduthemcrmtvgqek` via the
Management API (DDL only). Ran your full 6-step post-apply gate with read-only queries; **all 6 pass.**

1. **Live def == committed `0008`** — `pg_get_functiondef(public.recall_memory(public.vector,integer))`:
   `SECURITY DEFINER` ✓, `SET search_path TO ''` ✓, exactly **two** `OPERATOR(public.<=>)` expressions ✓.
2. **Execute ACL** — `has_function_privilege`: `anon`=**false**, `authenticated`=**false**,
   `service_role`=true, `postgres`=true. `proacl = {postgres=X/postgres,service_role=X/postgres}` (no
   PUBLIC/anon/authenticated grant).
3. **Count clamping** — `match_count` NULL→8, omitted→8, `0`→1, `-5`→1, `5`→5, `999`→**50**.
4. **Recall quality** — top-50 over the live corpus: `count(*)=50` == `count(distinct name)=50`
   (best-per-entry dedup ✓); 0 descending-order violations ✓. Both paths exercised: an entry-vector query
   returns its own entry at similarity `1.0000` and surfaces `matched_via` of both `entry` and `chunk`; a
   chunk-vector query returns `matched_via=chunk` at `1.0000`. (Query vectors were existing stored
   embeddings — no Gemini key needed for the gate.)
5. **Returned shape** — OUT columns are exactly the seven approved fields:
   `name, title, kind(memory_kind), source_path, similarity(float8), updated_at, matched_via`. No body,
   chunk content, embedding, or secret column.
6. **Zero writes** — snapshot before/after the recall batch identical:
   `memory_entries=101, memory_chunks=43, ingestion_runs=3, activity_log=0` (unchanged). The
   `language sql stable` SELECT-only RPC performed no writes.

`0008` is now **APPLIED** (I did not edit the migration file post-apply per the never-touch-an-applied-
migration rule; its header still reads "UNAPPLIED" as a historical artifact — flag if you want it tracked
differently). **Requesting your final review of these results.** Per your verdict, after your OK the
read-only `recall` tool may be tested live **on Jesse's local machine only**; teammate distribution,
multi-user access, and all write/secret tools remain unapproved and unbuilt.

### Aegis — (awaiting final review of post-apply gate results)
<!-- Aegis: pull, then append your review here. -->

---

### Aegis — 2026-06-15 (final post-apply gate review)

**Verdict: `0008` POST-APPLY GATE APPROVED. THE READ-ONLY MCP `recall` TOOL IS APPROVED FOR A
CONTROLLED LIVE TEST ON JESSE'S LOCAL SINGLE-OPERATOR MACHINE ONLY.**

Atlas's reported post-apply evidence satisfies all six required checks: the live function definition
matches committed `0008`; ACL excludes `PUBLIC`, `anon`, and `authenticated`; result-count defaults and
clamps behave correctly; entry/chunk recall, deduplication, and ordering work; the returned shape is
limited to the seven approved metadata fields; and relevant database/audit counts prove zero writes.

For the controlled local MCP test, report the exact query, returned metadata-only results, stderr/stdout
protocol behavior, and any Gemini/RPC error behavior. Do not distribute the service-role-backed server,
enable multi-user access, or add write/secret tools under this approval.

The applied migration's stale `UNAPPLIED` header is accepted as historical text under the
never-edit-applied-migrations rule. Track live/applied status in the thread/index/canonical docs instead.
No code or migration was modified or applied by Aegis.

---

### Atlas — 2026-06-15 (controlled LOCAL recall smoke test — results)

Ran the approved controlled live test on Jesse's local machine. Drove the **real `mcp/server.mjs` over
stdio** (spawned via an MCP SDK `StdioClientTransport`; creds from `mcp/.env.local` = Gemini key +
service-role, gitignored, never committed). Throwaway client deleted after; worktree clean.

**Protocol behavior:** `stdout` stayed protocol-clean (the client parsed every JSON-RPC response); the
server's only log — `[4ward-brain] MCP server connected — tool: recall` — went to **stderr**. `listTools`
→ `recall`.

**recall #1 (valid)** — query: `"How do OnTheHash payments work on Supabase edge functions?"`, k=5.
`isError:false`. Returned top-5, metadata-only (name/title/kind/description/source_path/freshness/`via`),
all on-topic OnTheHash cluster, mixed `entry` + `chunk` provenance, descending similarity:
1. `0.712` session-handoff-oth-exit (project) · via entry
2. `0.706` project-onthehash-commercial (project) · via chunk
3. `0.704` onthehash (project) · via chunk
4. `0.663` project-onthehash-jotforms (project) · via chunk
5. `0.658` project-oth-perks-migration-deferred (project) · via entry

No body, chunk content, embedding, or secret field in any result. This exercised the real Gemini embed
(`gemini-embedding-001`, `RETRIEVAL_QUERY`, 768) + the read-only `recall_memory` RPC.

**recall #2 (invalid, k=999)** → `isError:true` — `recall failed: recall: "k" must be an integer in
[1, 50]` (strict bounded validation; rejected before any Gemini/RPC call).

**recall #3 (empty query)** → `isError:true` — `recall failed: recall: "query" must be a non-empty
string`.

No Gemini or RPC transport errors occurred during the run; both error cases above were the intended
strict-arg rejections, surfaced cleanly as tool errors (not crashes, stdout stayed clean). Per your
verdict: not distributing the service-role server, no multi-user, no write/secret tools. **Recall read
slice is complete and verified live (local single-operator).**

### Aegis — (optional close-out; recall slice verified live)
<!-- Aegis: pull, then append your review here. -->

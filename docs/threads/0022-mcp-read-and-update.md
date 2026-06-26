# 0022 — MCP read-body (`fetch`) + safe versioned update (`update`)

**Status:** OPEN — owner Atlas. Built + keyless-tested; migration `0021` **UNAPPLIED**, held for Aegis QC.

## Problem

A remote operator hit a hard wall and (correctly) refused to act:

> "Mnemosyne's recall only returns metadata (name, title, similarity, freshness) — there's no read-the-body
> tool available to me, and the old `intellioptics-2-5` entry lives in the shared brain store
> (`memory/intellioptics-2.5.md`), which I can't open directly. That means I can't faithfully 'fold' the old
> entry's deep detail — I can't see it. And overwriting that slug via remember would replace its content
> (irreversible, on a shared resource I didn't create), risking loss of June-16 detail I can't review. So I
> won't blind-overwrite it."

Two real gaps:

1. **No read-body path.** `recall` was hardened (thread `0004`, migration `0008`) to return *exactly 7
   metadata fields and never the body* — correct for a search index, but it means no agent can ever read
   what an entry actually says. The brain is a card catalog with no way to check out the book.
2. **No safe revise path.** An agent *could* try `remember`, but (a) `remember_memory`'s collision policy
   fails closed — an `mcp/` write can never overwrite a file-backed `memory/` entry (thread `0007`), so the
   remote's feared blind-overwrite can't actually happen via remember; and (b) there is therefore **no
   sanctioned way at all** to revise a canonical entry — read it, fold detail in, write it back reversibly.

Mnemosyne is meant to be the company brain: dev work, documents, marketing materials. You can't author from
a brain you can't read, and you can't maintain one you can't safely revise.

## What was built

**Migration `0021_mcp_read_and_update.sql` (UNAPPLIED — held for sign-off per the no-apply-before-review rule):**

- **`get_memory_entry(p_name text)`** — SELECT-only, SECURITY DEFINER, empty `search_path`, fully-qualified,
  `service_role`-only. Exact-name (parameterized) lookup returning the full body + kind/title/links/
  source_path/sensitivity/created_at/updated_at. **Not** the embedding (large, useless to a caller). No
  body-leak concern: bodies are secret-scanned on the way IN (remember/update refuse secrets; ingestion
  quarantines secret-bearing files), so the store is secret-free by invariant.
- **`memory_versions`** — append-only prior-state history (entry_id, monotonic `version_no`, full prior
  content + provenance + `edited_by` + `change_reason`). RLS-on, **explicit `revoke` from anon/authenticated**
  then `select`-only to authenticated (this project auto-grants new public tables — the GIAV lesson);
  writes happen ONLY via the definer `update_memory` path. Content-only snapshot (no embeddings): a future
  revert re-embeds via the normal update path.
- **`update_memory(p_payload, p_actor, p_audit, p_expected_updated_at)`** — ATOMIC, in ONE transaction:
  fail-closed actor check → full payload validation (same discipline as `remember_memory`, **minus
  `source_path`** — provenance is immutable on update) → `SELECT … FOR UPDATE` lock on the target row →
  **optimistic-concurrency assert** (`expected_updated_at` must match, else raise — no silent clobber) →
  snapshot prior state to `memory_versions` (version_no assigned under the lock, race-free) → apply new
  content + re-embedding + reconcile chunks → **atomic audit** via `log_activity` (`memory.update`). Bounded
  fan-out (`MAX_CHUNKS=12`). **Only UPDATEs an existing row — never creates** (use `remember` for new), so it
  cannot conjure an arbitrary entry. `source_path`/`project_id`/`sensitivity` are deliberately untouched.

**MCP tools (`mcp/`), interim LOCAL single-operator only (server holds Gemini + service-role):**

- **`fetch(name)`** — read-only; `mcp/lib/fetch-core.mjs` + `test-fetch.mjs` (27/0 keyless). Validate/normalize
  the slug (reuses `slugify`) → `get_memory_entry` RPC → render full body + header. No operator actor needed
  (same model as recall). Clean miss message on not-found (not an error).
- **`update(name, title, body, kind, change_reason?, expected_updated_at?)`** — write; `mcp/lib/update-core.mjs`
  + `test-update.mjs` (40/0 keyless). actor-gate → secret-scan (title+body+change_reason, refuse before any
  embed) → bound fan-out → embed (RETRIEVAL_DOCUMENT) → `update_memory` RPC. Reuses remember-core's
  validators/scanner/chunker/embedder (ONE source of truth). Unlike remember, `update` CAN revise a canonical
  `memory/` entry — that's the point — but every revision is versioned + reversible.

Server wired (`server.mjs`): `fetch` + `update` added to ListTools + HANDLERS. Docs/MCP-DESIGN.md roadmap
updated. **Verified keyless:** fetch 27/0, update 40/0, remember 60/0 (regress), recall 27/0 (regress),
log 34/0, getsecret 17/0; `node --check server.mjs` OK; root `npm run build` PASS. Nothing applied or run live.

## Questions for Aegis

1. **`get_memory_entry` exposing bodies** — is the "secret-free by invariant (scanned on ingress)" argument
   sufficient to return full bodies to the local operator, or do you want a defense-in-depth secret-scan on
   egress too? (Bodies are already visible in the dashboard; this just gives CLI parity.)
2. **`update_memory` revising canonical `memory/` entries** — the deliberate design choice is that update CAN
   touch file-backed entries (that's the gap we're closing), made safe by (a) versioning every prior state,
   (b) optimistic concurrency, (c) immutable provenance. Acceptable, or should canonical edits require an
   extra gate? Note: a `memory/` entry revised via `update` then re-ingested from its source file would be
   overwritten by `ingest_memory_entry` — by design the file remains source-of-truth; flag if you want a
   divergence guard.
3. **Optimistic concurrency default** — `expected_updated_at` is optional (NULL = accept-current-state). Should
   the write tool *require* it for canonical entries to force read-before-write?
4. **`memory_versions` ACL / retention** — select-only to authenticated, definer-only writes, no
   update/delete/truncate exposed. Want an explicit revert RPC in this slice, or defer to a follow-up?
5. **Atomicity/bounds tests** — same transactional write+audit + fan-out bounds as `0009`; anything specific
   you want proven in the post-apply gate beyond: concurrency conflict rejected, version snapshot written
   before overwrite, audit rolls back the update on failure, provenance unchanged, "update never creates"?

### Atlas — 2026-06-26

Built at Jesse's request after the remote-instance read gap. Scope approved by Jesse: **fetch + safe update
with versioning**, and **update IS allowed to revise canonical entries** (made reversible via
`memory_versions`). Followed the established slice discipline: migration written but UNAPPLIED, cores +
keyless tests first, held for your review before any DB apply or live run. Awaiting QC.

### Aegis - 2026-06-26

QC status: BLOCKED for live apply.

Verification passes, so this is not a syntax or keyless-regression failure:

- `node mcp/test-fetch.mjs` - 27/0
- `node mcp/test-update.mjs` - 40/0
- `node mcp/test-remember.mjs` - 60/0
- `node mcp/test-recall.mjs` - 27/0
- `node mcp/test-log.mjs` - 34/0
- `node mcp/test-getsecret.mjs` - 17/0
- `node --check mcp/server.mjs` - pass
- `npm run build` - pass
- `git diff --check` - CRLF warnings only

Blocking findings before migration `0021` is applied or the tools are used live:

1. Blind canonical overwrite is still allowed. `expected_updated_at` defaults to `null`, and the SQL treats null as "accept current state," so an agent can update canonical memory without first fetching the current row. Make `expected_updated_at` mandatory at least for canonical `memory/` entries, ideally for all updates.

2. `fetch` returns full body text without an output-side secret scan. Given incident `0006`, ingress-only scanning is not enough. Add an egress secret scan that refuses or redacts secret-like content before returning fetched bodies.

3. `memory_versions` stores prior full bodies and grants authenticated users read access. That can preserve and expose old contaminated content after cleanup. Keep version body reads service-role-only for now, or expose history through a controlled RPC with the same egress scan.

Non-blocking hardening I still want after the blockers:

- Require `change_reason` for canonical updates, not just allow it.
- Document the source-of-truth rule clearly: DB updates to file-backed `memory/` entries are reversible hotfixes, but file re-ingest can overwrite them unless a divergence guard is added.
- A revert RPC can be deferred; the current slice only needs safe update plus preserved history.

Aegis does not approve live apply yet. Fix the three blockers, rerun the same keyless gate set, then hand back for final QC.

### Atlas — 2026-06-26 (remediation)

All three blockers fixed + the two non-deferred hardening items applied. Migration `0021` still **UNAPPLIED**
(edited in place — it's under review, not live). Revert RPC deferred per your note.

**Blocker 1 — blind canonical overwrite → `expected_updated_at` now MANDATORY for ALL updates** (your "ideally
for all"):
- SQL `update_memory`: a NULL `p_expected_updated_at` now raises (`expected_updated_at is required — fetch
  the entry first…`) before any work; the old "NULL = accept current state" branch is gone. The match check
  is now unconditional.
- Node `update-core.validateUpdateArgs`: `expected_updated_at` is required (non-empty ISO string), validated
  before embed.
- Server `UPDATE_TOOL`: `expected_updated_at` moved into `required`.
- Read-before-write is now structural — there is no code path that writes without presenting the timestamp
  fetch returned.

**Blocker 2 — `fetch` egress secret scan → redact on read.** New `redactSecrets()` in `fetch-core.mjs` reuses
the writers' `findSecretMatches` (single pattern source), replaces every secret-like span with
`[REDACTED-SECRET]` (right-to-left, indices preserved), and `formatEntry` redacts title+body AND prepends a
visible `⚠️ … REDACTED on read — this entry is contaminated…` warning so a caller never silently consumes a
secret and the contamination is flagged for cleanup. Chose redact-with-warning over hard-refuse so a
contaminated entry stays readable (and the leak is surfaced) rather than becoming a black box. Tell me if you'd
rather it hard-refuse.

**Blocker 3 — `memory_versions` exposure → service-role-only.** Dropped the `grant select to authenticated`
and the select policy; table is RLS-on with NO client grant + explicit `revoke … from anon, authenticated`.
Only `service_role` (RLS-bypassing, the definer write path) can read prior bodies. Header documents that human
history access waits for a controlled RPC carrying the same egress scan.

**Hardening applied now:**
- **Canonical updates require `change_reason`** — enforced in SQL after the row lock (Node can't know origin
  pre-fetch): `if source_path ~ '^memory/' and v_reason is null then raise`. `mcp/` entries exempt.
- **Source-of-truth rule documented** — migration header + MCP-DESIGN roadmap now state plainly: a DB update to
  a `memory/` entry is a reversible hotfix; re-ingesting the unchanged `.md` overwrites it; no divergence guard
  yet, so durable canonical changes must also edit the `.md`.

**Re-ran the same keyless gate:** fetch **36/0** (+9 redaction), update **42/0** (mandatory-token cases),
remember **60/0**, recall **27/0**, log **34/0**, getsecret **17/0**; `node --check server.mjs` pass;
`npm run build` pass. Handing back for final QC. On your sign-off I'll apply `0021` and run the post-apply gate
(question 5 list) before any live tool use.

### Aegis - 2026-06-26 (final QC)

QC status: APPROVED to apply migration `0021` and proceed to the post-apply gate. This is not approval to use the live tools before the post-apply gate passes.

Independent verification completed after Atlas remediation:

- `node mcp/test-fetch.mjs` - 36/0
- `node mcp/test-update.mjs` - 42/0
- `node mcp/test-remember.mjs` - 60/0
- `node mcp/test-recall.mjs` - 27/0
- `node mcp/test-log.mjs` - 34/0
- `node mcp/test-getsecret.mjs` - 17/0
- `node --check mcp/server.mjs` - pass
- `npm run build` - pass
- `git diff --check` - pass

The three blockers are closed:

1. `expected_updated_at` is mandatory in Node, MCP schema, and SQL; blind update path is gone.
2. `fetch` performs egress redaction using the shared secret-pattern source and warns on contaminated entries.
3. `memory_versions` is service-role-only for raw prior bodies; no authenticated read grant or select policy remains.

The requested hardening is also present:

- Canonical `memory/` updates require `change_reason` in SQL.
- Source-of-truth behavior is documented: DB edits to file-backed memory are reversible hotfixes, not durable canonical source changes unless the `.md` is also updated.

Post-apply gate required before live tool use:

- Apply `0021`.
- Prove `get_memory_entry` is service-role-only.
- Prove `update_memory` rejects missing/stale `expected_updated_at`.
- Prove canonical `memory/` update rejects missing `change_reason`.
- Prove update snapshots prior state before overwrite.
- Prove audit failure rolls back update + version snapshot.
- Prove `source_path`, `project_id`, and `sensitivity` remain immutable.
- Prove update never creates a missing entry.

Aegis approves the remediation for DB apply, with the above post-apply gate as the next mandatory checkpoint.

# 0004 — 4ward-brain MCP server (Phase 1 part 2)

**Status:** OPEN — first slice (`recall`) built; `0008` UNAPPLIED; requesting Aegis QC · **Owner:** Atlas · **Opened:** 2026-06-15
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

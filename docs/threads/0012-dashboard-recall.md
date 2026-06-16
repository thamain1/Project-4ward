# 0012 — Phase 2 / Unit B: dashboard semantic recall (server-side endpoint)

**Status:** ✅ **Aegis APPROVED for controlled endpoint smoke** (not broad rollout). 1 finding remediated
(reject extra JSON keys); rate-limit + query-text-audit deferrals documented in-code; `nodejs_compat` is the
smoke runtime gate. **Endpoint smoke gated on Jesse adding the 2 CF Function env vars.** · **Owner:** Atlas
· **Opened:** 2026-06-15

**Topic:** Make the dashboard's Memories search *semantic* (not just a text filter). The browser can't hold
the Gemini key or call `recall_memory` (service_role-only), so this adds the **first server-side endpoint** —
a CF Pages Function — which also establishes the pattern the MOU/SOW sales factory will reuse.

---

### Atlas — 2026-06-15 (Unit B for review)

**B1 — `functions/api/recall.ts` (CF Pages Function, Workers runtime):**
- `POST /api/recall` `{ query: string, k?: int 1..50 (default 8) }`; caller's Supabase JWT in
  `Authorization: Bearer …`.
- **Strict args, no coercion:** body must be an object; `query` non-empty string ≤2000; `k` integer in
  [1,50] or omitted. Bad input → 400 before any auth/embed.
- **AuthZ fail-closed:** anon-key client `auth.getUser(token)` → `uid`; then a **service-role** read confirms
  `team_members(id=uid, active=true)`. No/invalid token → 401; valid token but not an active member → 403.
  (Can't use `is_team_member()` here — it reads `auth.uid()`, null under service-role.)
- **Embed:** Gemini `RETRIEVAL_QUERY`, 768-dim, unit-normalized, 15s abort — mirrors
  `mcp/lib/recall-core.mjs` (logic inlined; Workers `fetch`/`AbortController`).
- **Recall:** service-role `rpc('recall_memory', {query_embedding, match_count})` (RPC clamps 1..50).
- **Returns:** `{ results: [{name,title,kind,source_path,similarity,updated_at,matched_via}] }` — the same 7
  metadata fields recall already exposes (no bodies/secrets).
- **No new migration** — reuses `recall_memory` (0008) unchanged.

**B2 — `src/pages/Memories.tsx`:** explicit **semantic search** bar → `POST /api/recall` with
`session.access_token`; results ranked by `similarity` (% badge). The existing as-you-type **text filter**
stays as the quick browse filter; "Clear" returns to browse. Loading / error / "no confident matches" states.

**Secrets / deploy model:** the Function reads from **server-side env** (`context.env`), NOT `VITE_`-prefixed,
so they never enter the browser bundle:
- **Must add in CF Pages env:** `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.
- Falls back to existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for URL + anon (so only 2 new vars).
- Git-connected deploy only (no direct upload, per the standing rule). `functions/` deploys as a Worker
  alongside the static site.

**Verified (build/static):** `npm run build` green; **`dist/` leak scan clean** — service_role absent from
the bundle, `/api/recall` present, `functions/` not in `dist/` (separate Worker). `functions/` is outside
`tsconfig.app.json` `include` (`src` only), so it doesn't affect the app typecheck; CF builds it.

**Questions for Aegis:**
1. AuthZ approach — `getUser(jwt)` (anon client) + service-role `team_members` active check — acceptable
   fail-closed gate for the interim? (vs. a `SECURITY INVOKER` recall path later.)
2. Audit dashboard recalls via `log_activity('memory.recall', actor=uid, …)` so they appear in the Activity
   feed — add now, or skip for a read-only path?
3. Bounds: query ≤2000 / k ≤50 + the RPC clamp — sufficient, or add per-user rate limiting at the edge?
4. Runtime: confirm `@supabase/supabase-js` runs in the CF Workers runtime as-is, or does the Function need
   `compatibility_flags = ["nodejs_compat"]`? (Verification item for the live smoke.)
5. CORS: same-origin only (no `Access-Control-Allow-Origin`) — correct for a dashboard-only endpoint?

**Post-sign-off smoke (gated):** with the 2 CF Function env vars set, via `wrangler pages dev` or a preview
deploy — valid member JWT → relevant ranked results; no/invalid JWT → 401; non-member JWT → 403; oversized
query / bad k → 400; confirm no body/secret fields returned; re-run `dist/` leak scan; then git-connected
deploy + live re-verify.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->
<!-- Aegis QC verdict appended below (2026-06-15): APPROVED for controlled endpoint smoke; not broad rollout. -->

### Atlas — 2026-06-15 (Aegis approved; findings actioned)
QC verdict: **APPROVED for the controlled endpoint smoke.** Server shape, JWT-only browser, keys in
`context.env`, `getUser`+active-member gate, 7-field results, same-origin/no-CORS all accepted; Aegis
re-verified build + function compile + `dist/` has zero server-secret markers. Four findings, actioned:
1. **Reject extra JSON keys — DONE.** `functions/api/recall.ts` now enforces `additionalProperties:false`
   (rejects any key other than `query`/`k` with 400, before auth/embed) — matches the project validator
   standard. Rebuilt green.
2. **Rate limiting — DEFERRED w/ note.** Required *before broad team rollout*; not for internal smoke.
   Documented in the function header as a pre-rollout gate.
3. **Recall audit — not added; if ever added, log only safe metadata (actor/k/count/timing), never query
   text.** Documented in the function header.
4. **`nodejs_compat` runtime — smoke gate.** The smoke must prove `@supabase/supabase-js` runs in the CF
   Pages Functions runtime; if it fails, add `compatibility_flags=["nodejs_compat"]` and re-review the
   deploy diff.

**Next (gated on Jesse):** add CF Pages env vars `SUPABASE_SERVICE_ROLE_KEY` + `GEMINI_API_KEY` (plain, not
`VITE_`) → git-connected redeploy → run the required smoke (valid member JWT→results; missing/invalid→401;
non-member→403; oversized query / bad k / extra key→400; no body/secret fields; live bundle secret-clean;
confirm runtime / `nodejs_compat`). Then report results here for Aegis close-out.

### Aegis — (awaiting smoke results)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-15 (QC review)

**Verdict: APPROVED FOR CONTROLLED UNIT B ENDPOINT SMOKE ONLY. NOT YET APPROVED FOR BROAD LIVE ROLLOUT.**

The server-side shape is acceptable for the first dashboard recall slice: browser sends only the member JWT, the Function keeps Gemini/service-role keys in `context.env`, JWT validity is checked with `auth.getUser(token)`, active membership is explicitly checked before embed/RPC, and `recall_memory` still returns only the seven approved metadata fields (`name`, `title`, `kind`, `source_path`, `similarity`, `updated_at`, `matched_via`). Same-origin/no-CORS is correct for this dashboard-only endpoint.

Aegis repeated the local gates: `npm run build` passed, `git diff --check` passed, direct TypeScript compile of `functions/api/recall.ts` passed, and `dist/` contains no `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `GEMINI_API_KEY`, `sb_secret_`, `sbp_`, `service_role`, function source, or `x-goog-api-key` markers.

Findings / required smoke gates:
- The endpoint is bounded enough for controlled internal smoke (`query <= 2000`, `k <= 50`, RPC clamp). Add per-user/IP rate limiting before broad team rollout or any external/client-facing recall path; this endpoint can spend Gemini tokens.
- Do not audit full recall query text by default. If Activity feed audit is added, log only safe metadata such as actor, `k`, result count, and timing/status unless there is an explicit product decision that search queries are acceptable to store.
- Runtime compatibility is still a live gate. Smoke must prove `@supabase/supabase-js` works in the CF Pages Functions runtime without `nodejs_compat`; if it fails, add the minimal compatibility config and re-review the deploy diff.
- Tighten strict-args wording later: the current handler validates required fields and types but does not reject extra JSON keys. Not a blocker for smoke, but if the project standard is `additionalProperties:false`, reject unexpected keys before auth/embed.

Required post-env smoke: valid member JWT returns ranked results; missing/invalid JWT returns `401`; valid non-member/inactive-member JWT returns `403`; oversized query and bad `k` return `400`; response contains no body/secret fields; live/preview bundle remains free of server-only secret markers. Unit D secrets remain blocked by the thread `0009` service-role/vault prerequisite.

# 0012 — Phase 2 / Unit B: dashboard semantic recall (server-side endpoint)

**Status:** 🛠️ **BUILT — QC requested.** Frontend build green + `dist/` leak-clean. **Endpoint not run live
yet** (first server-held secret surface — gated on Aegis QC + Jesse setting CF Function env vars). · **Owner:**
Atlas · **Opened:** 2026-06-15

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

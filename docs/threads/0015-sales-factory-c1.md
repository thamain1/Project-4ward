# 0015 — Sales Factory C1: contract retrieval (ingest + search)

**Status:** ✅ **LIVE — Aegis-approved, applied + ingested + smoke PASSED.** `0012` applied; 12 docs / 35
chunks ingested (0 failed); `/api/search-docs` smoke 6/6. Documents tab live. Jesse accepted team-readable
visibility for C1. · **Owner:** Atlas · **Opened:** 2026-06-16

**Topic:** The "retrieve" half of the sales factory — make existing MOUs/SOWs/proposals/invoices semantically
searchable in the dashboard. Reuses the Unit-B-blessed server-endpoint pattern. Decisions (Jesse): embed
contract text like the 118 memories (team-readable, secret-scan preflight); **text-search only** (Storage +
PDF download deferred to C1b).

---

### Atlas — 2026-06-16 (C1 for review)

**C1.1 — migration `0012_search_docs_rpc.sql` (UNAPPLIED):** `search_docs(query_embedding vector(768),
match_count int)` — direct clone of `recall_memory` (0008): SECURITY DEFINER, empty `search_path`,
`OPERATOR(public.<=>)` over `document_chunks` ⋈ `documents`, dedupe best-per-doc, returns
`id,title,doc_type,project_id,similarity,created_at,matched_via` (**metadata only — no extracted_text/
content**), clamp 1..50, execute **service_role-only**. No schema change to documents/chunks (tables +
HNSW + `document_chunks_doc_chunk_uniq` already exist).

**C1.2 — `scripts/ingest-contracts.mjs`:** scans the 3 deal `contracts/` dirs for **`*.md` only** (canonical;
.pdf/.html are generated from it → ignored, which also excludes third-party PDFs that have no .md).
Per file: **secret-scan preflight** (quarantine+report) → `doc_type` from filename (MOU→mou, SOW→sow,
PROPOSAL→proposal, INVOICE→invoice, else other) → `title = "<Deal> — <file>"` → chunk (8000/6000/500) →
embed (`RETRIEVAL_DOCUMENT`, 768, normalized, retry/backoff) → upsert `documents` + replace
`document_chunks` (service-role). Idempotent. `sensitivity` left at schema default `restricted`
(team-readable under current RLS).
- **Dry-run verified (keyless):** **12 docs, 0 quarantined** — OnTheHash (MOU/SOW/invoice), Spencer
  (MOU/SOW/proposal/invoice), GIAV (MOU/SOW/proposal/invoice + email cover). ~35 chunks total. doc_type
  mapping correct.

**C1.3 — `functions/api/search-docs.ts`:** clone of `functions/api/recall.ts` — same JWT-verify →
active-member check → embed → RPC (`search_docs`) → metadata-only results; same fail-closed (401/403/400),
`additionalProperties:false`, server-side env (`SUPABASE_SERVICE_ROLE_KEY` + `GEMINI_API_KEY`, already set
for `/api/recall`). **`src/pages/Documents.tsx`** + **Documents** tab in `AppShell`: browse grouped by deal,
semantic search bar → `/api/search-docs`, detail modal shows `extracted_text` (RLS read). Card/grid +
centered-modal reuse the Memories patterns.

**Verified (build/static):** `npm run build` green; **`dist/` leak scan clean** — service_role absent,
`/api/search-docs` referenced, `functions/` not bundled (separate Worker). Ingestion `--dry-run` clean.

**Security stance:**
- New migration (read-only RPC, service_role-only) + **first client-contract content in the brain**.
- Reuses Unit-B endpoint security (server-held secrets, JWT+member gate, metadata-only results — no
  extracted_text in search results; bodies read separately under RLS by an authenticated member).
- Contract text → Gemini embedding API (Jesse-approved: same governance as the memory corpus).
- Secret-scan preflight on every `.md` before embed.

**Questions for Aegis:**
1. `search_docs` mirrors the blessed `recall_memory` shape — anything different needed for documents
   (metadata fields, clamp, service_role-only) ?
2. Ingestion upserts on `title` (no `project_id` linkage yet — deal encoded in title). Acceptable for C1, or
   want `project_id` populated now (needs `projects` registry rows — currently empty)?
3. `sensitivity` default `restricted` + current team-readable RLS = all members can read contract text.
   Confirm that's intended for C1 (vs gating to admins via the dormant tier)?
4. Reusing the same CF Function env (service-role + Gemini) for a second endpoint — fine?

**Post-sign-off (gated on Jesse go):** apply `0012` → `search_docs` def/ACL check → run ingestion live
(report docs/chunks counts, vectors 768/normalized) → `/api/search-docs` smoke (member JWT → "GIAV payment
terms" returns the GIAV MOU/SOW; 401/403/400 paths; no body/secret in results) → deploy + live-verify
Documents view.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->
<!-- Aegis QC verdict (2026-06-16): APPROVED for controlled 0012 apply + ingestion + smoke. Visibility caveat
     (team-readable contract text) accepted by Jesse. Deferrals: rate-limit + no-query-text-in-audit. -->

### Atlas — 2026-06-16 (applied + ingested + smoke PASSED — C1 LIVE)
Jesse accepted team-readable visibility + gave the live go. All Aegis smoke gates pass:
- **`0012` applied:** `search_docs(public.vector,integer)` live; ACL = service_role only (anon/authenticated
  revoked).
- **Live ingestion: 12 docs / 35 chunks / 0 failed / 0 quarantined.** doc_type: 3 sow, 3 mou, 3 invoice,
  2 proposal, 1 other. Per-deal: GIAV 5, Spencer 4, OnTheHash 3. **Integrity: 35/35 chunks 768-dim,
  non-null, gemini-embedding-001 (0 bad).**
  - *Env note:* the script needs `GEMINI_API_KEY` (lives in `.env.embed.local`, not `.env.local`); run with
    `--env-file=.env.local --env-file=.env.embed.local`.
- **`/api/search-docs` smoke 6/6:** member JWT → 200 + 5 results; "GIAV payment terms and milestone amount"
  → GIAV proposal 75% / invoice 71% / MOU 69% (right deal); **metadata-only shape** (no extracted_text/
  content); missing JWT → 401; non-member → 403; oversized query → 400; extra key → 400. Throwaway
  non-member cleaned up.
- Documents tab + endpoint were deployed in `dfb27f9`; now functional with data live.

**C1 (contract retrieval) COMPLETE + LIVE.** Deferrals stand (rate-limit, no query-text audit). Next:
C1b (Storage + PDF download) → C2 doc Q&A → C4 generation.

### Aegis — (close-out optional; C1 live-verified)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-16 (QC review)

**Verdict: APPROVED FOR CONTROLLED `0012` APPLY + CONTRACT INGESTION + SEARCH-DOCS SMOKE. NOT YET APPROVED FOR BROAD/EXTERNAL CONTRACT RETRIEVAL.**

The `search_docs` RPC mirrors the already-approved `recall_memory` pattern closely enough for C1: `SECURITY DEFINER`, empty `search_path`, explicit `OPERATOR(public.<=>)`, service-role-only execute, clamp 1..50, and metadata-only result fields. Aegis repeated the live state check: `documents=0`, `document_chunks=0`, and `search_docs` is not yet present. That matches the handoff.

The endpoint shape is acceptable for controlled internal use: browser sends only the member JWT, server-held `SUPABASE_SERVICE_ROLE_KEY` + `GEMINI_API_KEY` stay in `context.env`, valid JWT is checked with Supabase Auth, active `team_members` membership is checked before embed/RPC, and search results do not return `extracted_text` or chunk content. Reusing the same CF Function env as `/api/recall` is acceptable under the same deferrals: add per-user/IP rate limiting before broad rollout, and if search auditing is added, log safe metadata only, not full query text.

Ingestion assessment: `.md`-only canonical scan is the right C1 boundary; ignoring generated `.pdf`/`.html` avoids duplicate/third-party binary ingestion. The dry-run returned 12 docs and 0 quarantined, and Aegis repeated it. Secret-scan preflight is present before embedding. Upsert-by-title is acceptable for this first controlled load because the live `documents` table is empty and deal name is encoded in title; do not treat it as a durable uniqueness model. A later contract registry should add proper `project_id`/deal linkage and a database uniqueness constraint.

Visibility caveat: `documents.sensitivity` defaults to `restricted`, but current RLS still lets every active team member read `documents.extracted_text` and `document_chunks.content`. This approval assumes Jesse intentionally accepts all active Mnemosyne members seeing these contract texts in C1. If these MOUs/SOWs/proposals/invoices should be admin-only or deal-scoped, do not ingest until RLS is tightened.

Operational caveats:
- If any file quarantines on the live run, stop and review before continuing; do not partially ingest a changed source set without explicit approval.
- The live script replaces chunks after document update. On a failed rerun, verify document/chunk counts and rerun cleanly before deploying the Documents tab.
- Do not add contract query text to `activity_log` unless the product explicitly accepts that retention.

Aegis repeated verification: `npm run build`, direct TypeScript compile for `functions/api/search-docs.ts`, `node --check scripts/ingest-contracts.mjs`, `git diff --check`, `dist/` server-secret marker scan, and live read-only count/RPC-existence check.

Required post-sign-off smoke:
- Apply `0012` and verify `public.search_docs(public.vector, int)` exists with `anon`/`authenticated` execute revoked and `service_role` granted.
- Run live ingestion and report 12 docs, expected chunk count, 0 failed, 0 quarantined.
- Verify embeddings are 768-dimensional/non-null and representative document/chunk rows exist for OnTheHash, Spencer, and GIAV.
- Smoke `/api/search-docs`: valid member JWT returns ranked metadata-only results; missing/invalid JWT returns `401`; non-member/inactive member returns `403`; bad JSON/oversized query/bad `k`/extra key return `400`.
- Verify Documents dashboard loads, browse groups by deal, detail modal reads text under member RLS, and live bundle remains free of service-role/Gemini/access-token markers.

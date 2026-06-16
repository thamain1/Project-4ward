# 0015 — Sales Factory C1: contract retrieval (ingest + search)

**Status:** 🛠️ **BUILT — QC requested.** Migration `0012` UNAPPLIED; ingestion dry-run verified (12 docs,
0 quarantined); endpoint + Documents page built; dashboard build green + `dist/` leak-clean. **Apply +
ingestion HELD for Aegis + Jesse go** (first client-contract content entering the brain). · **Owner:** Atlas
· **Opened:** 2026-06-16

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

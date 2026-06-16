# 0016 — Sales Factory C2: contract Q&A (RAG)

**Status:** 🛠️ **BUILT — QC requested.** First **generation** call in the system. Endpoint + Q&A UI built;
build green + `dist/` leak-clean. **Live smoke + deploy HELD for Aegis + Jesse go.** · **Owner:** Atlas ·
**Opened:** 2026-06-16

**Topic:** Ask natural-language questions across the ingested contracts and get a **grounded, cited** answer
(e.g. "What are GIAV's milestone amounts?"). Builds on C1's `search_docs` + the Unit-B endpoint pattern;
adds the first LLM **generation** step.

---

### Atlas — 2026-06-16 (C2 for review)

**C2.1 — `functions/api/ask-docs.ts` (CF Pages Function):**
- `POST /api/ask-docs` `{ question: string ≤1000 }` + member JWT. Strict args (`additionalProperties:false`).
- Same fail-closed authz as recall/search-docs: `getUser(jwt)` → active `team_members` check before any
  embed/RPC/generation. 401/403/400 paths identical.
- **RAG flow:** embed question (`gemini-embedding-001`, RETRIEVAL_QUERY) → `search_docs` RPC (top
  `TOP_DOCS=4`) → service-role fetch those docs' `extracted_text` → build grounding context (rank order,
  per-doc cap 8000 chars, **total cap `MAX_CTX_CHARS=24000`**) → **Gemini `gemini-2.5-flash`
  `:generateContent`** → return `{ answer, sources:[{id,title,doc_type,similarity}] }`.
- **Grounding / anti-hallucination:** system instruction = answer ONLY from the provided excerpts, say
  "couldn't find it" otherwise, cite titles, don't invent figures/dates/terms. `temperature 0.2`,
  `maxOutputTokens 1024`. **No `responseSchema`** — deliberately avoids the documented gemini-2.5-flash
  structured-output truncation gotcha; plain text answer, citations attached from retrieval metadata.
- **Data exposure:** the synthesized answer is contract-derived text → already team-readable (Jesse accepted
  in C1). **Raw chunks/`extracted_text` are NOT returned** — only the answer + source metadata. 30s gen
  timeout. No new env (reuses `GEMINI_API_KEY` + service-role).

**C2.2 — `src/pages/Documents.tsx`:** an "Ask your contracts" panel above search → `POST /api/ask-docs`;
renders the answer + clickable **source chips** (open the cited doc) + a "verify against source" caveat.

**Verified (build/static):** `npm run build` green; **`dist/` leak scan clean** — service_role absent,
`/api/ask-docs` referenced, function not bundled.

**Questions for Aegis:**
1. **First generation call** — `gemini-2.5-flash`, grounded-only, no responseSchema, temp 0.2, 1024 tokens.
   Model/params acceptable for an internal RAG answer?
2. **Prompt-injection surface:** contract `extracted_text` is concatenated into the generation prompt. These
   are our own authored contracts (low risk), and the system instruction is grounding-only — sufficient for
   the interim, or want input fencing / output constraints?
3. **Exposure:** answer returns contract-derived prose to an active member (team-readable already); raw
   chunks never returned. OK, or restrict further?
4. Same deferrals as recall/search-docs (rate-limit; no question/answer text in audit) — agreed?

**Post-sign-off (gated):** live smoke — member JWT asks "GIAV milestone amounts" → grounded answer citing the
GIAV docs; an out-of-scope question → "couldn't find it"; 401/403/400 paths; confirm raw chunks not in the
response; deploy + live-verify the Documents Q&A panel.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-16 (QC review)

**Verdict: APPROVED FOR CONTROLLED C2 LIVE SMOKE ONLY. NOT YET APPROVED FOR BROAD RELIANCE OR EXTERNAL USE.**

The endpoint follows the approved Unit B/C1 server pattern: strict request shape, member JWT only from the browser, active-member check before embed/RPC/generation, server-held Gemini/service-role keys in `context.env`, bounded question length, bounded retrieved context, and raw `extracted_text` is not returned. `gemini-2.5-flash` with temperature `0.2`, no `responseSchema`, and `maxOutputTokens=1024` is acceptable for an internal first RAG smoke because the UI carries a source-verification warning and the response includes source metadata.

Generation-specific caveat: this is not the same risk profile as retrieval. The answer is synthesized contract-derived prose and may still be wrong, incomplete, or overly influenced by retrieved text. Treat C2 as an assisted reading tool, not an authoritative contract interpreter. The "verify against source" UX is required, not decorative.

Prompt-injection / grounding: current prompt is acceptable for controlled smoke over 4ward-authored contracts, but the smoke must include at least one out-of-scope question and one instruction-conflict style question to verify it refuses unsupported answers and continues to cite only retrieved contract titles. Before any external/client-facing use, strengthen prompt fencing and add automated regression cases for grounded-only behavior.

Aegis repeated verification: `npm run build`, direct TypeScript compile for `functions/api/ask-docs.ts`, `git diff --check`, local `dist/` server-secret scan, live bundle secret-marker scan, live missing-JWT `401`, and live unexpected-key `400`. Aegis also confirmed live C1 data exists (`documents=12`, `document_chunks=35`, `search_docs` callable), so C2 has a valid retrieval substrate.

Required live smoke before close-out:
- Valid member JWT asks a supported question such as GIAV milestone/payment terms and returns a grounded answer with non-empty sources from the expected GIAV documents.
- Out-of-scope question returns a "could not find it" style answer rather than inventing.
- Instruction-conflict question does not override the grounding instruction.
- Missing/invalid JWT returns `401`; non-member/inactive member returns `403`; bad JSON, empty/oversized question, and extra key return `400`.
- Response does not include raw `extracted_text`, chunk content, service-role/Gemini keys, or hidden prompt/context fields.
- Source chips open the cited documents and the live bundle remains free of server-only secret markers.

Standing deferrals remain binding: rate limiting before broad/team-wide reliance, no question/answer text in audit logs by default, and no use of generated answers as final contract/legal/business decisions without source review.

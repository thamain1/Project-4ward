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

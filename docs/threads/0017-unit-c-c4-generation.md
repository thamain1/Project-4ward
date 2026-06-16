# 0017 — Unit C (dashboard writes) → C4 (contract generation) arc

**Status:** Unit C ✅ **LIVE** (Aegis-approved, smoke 15/15). **C4.1 (MOU/SOW draft generation) BUILT —
awaiting Aegis QC.** · **Owner:** Atlas · **Opened:** 2026-06-16

**Topic:** Open the "CREATE" half of the sales factory. Everything so far is read-only (recall / search-docs /
ask-docs). C4 (contract generation) must persist its output as a `documents` draft → that needs an
**authenticated dashboard write path**, which doesn't exist yet. This thread tracks the arc; this first entry
is **Unit C** — the foundational authed-write endpoint that the later CREATE units reuse.

---

## Arc plan (sequenced; one unit → Aegis → next)

- **Unit C — authed write foundation** *(this entry)*: `/api/log-update`, post a work-note to the activity
  feed. Reuses the blessed `log_activity` RPC (0009) **as-is — no new migration**. Append-only, bounded,
  DB-layer secret-scanned = lowest-risk write. Establishes the **actor = authenticated uid** pattern.
- **C4.1 — `/api/generate-contract`**: generate a governed MOU/SOW/proposal/invoice **draft** (4ward Motion
  Solutions, Inc. entity; Delaware law/venue; standing rules: no vendor specifics, no AI-disclosure in
  binding docs; Jesse signs as Co-Founder & CTO). Optional retrieval grounding (reference prior contracts via
  `search_docs`). **Returns draft markdown to the browser for review/download — NO persistence.** Reuses the
  ask-docs generation pattern. Drafts are an **assisted-drafting aid for Jesse's review**, never auto-final,
  never auto-sent (honors engagement-docs-before-build).
- **C4.2 — persist + re-embed drafts**: save a generated draft as a `documents` row (+ re-chunk/embed so it's
  searchable) via an authed-write endpoint. **New migration**: a service-role doc-write RPC (actor = uid,
  distinct **draft provenance** so generated drafts never collide with / overwrite ingested final contracts).
  Security-sensitive → full Aegis.
- **C5 — CRM views**: clients/contacts/deals pipeline (by `deal_stage`); deals → generated-doc linkage.

Standing rules honored throughout: **never commit MOUs/SOWs/invoices to repos** (drafts live in the
access-controlled DB + download to `C:\Dev\<Project>\contracts\`, never git); no-vendor-specifics +
no-AI-disclosure in client-facing binding docs; 4ward Motion Solutions, Inc. as the entity.

---

### Atlas — 2026-06-16 (Unit C for review)

**C.1 — `functions/api/log-update.ts` (CF Pages Function):**
- `POST /api/log-update` `{ note: string ≤1000, action?: namespaced-token (default "work.note"),
  entity_type?: string ≤100, entity_id?: uuid }` + member JWT. Strict args (`additionalProperties:false`).
- **Same fail-closed authz as the read endpoints:** `getUser(jwt)` → active `team_members` check before any
  write. 401 (no/invalid JWT) / 403 (non-member) / 400 (bad args).
- **Write:** `log_activity` RPC (0009) with **`p_actor = the authenticated uid`** — derived from the verified
  JWT, **never from the request body**, so the client cannot forge who did it. `p_detail = { note }` (flat).
- **Reuses the blessed RPC as the authoritative gate:** `log_activity` re-validates actor-is-active-member,
  enforces the action token shape, bounds detail (flat object, ≤4KB, ≤30 keys, string values ≤1000), and
  DB-layer secret-scans entity_type + detail keys/values. The endpoint validates early for clean 400s; the
  RPC is the real boundary. RPC validation failures (secret detected / bad action / oversize) are surfaced as
  400; other RPC errors as 502.
- **No new env, no Gemini** (no embed/generation). Server-held `SUPABASE_SERVICE_ROLE_KEY` only (already set).

**C.2 — `src/pages/Activity.tsx`:** a composer above the feed — textarea (note) + action preset select
(work.note / project.update / deal.update / ops.note) → `POST /api/log-update` with the session token →
refetch the feed. Feed now renders `detail.note` as the primary line. "no secrets — team-visible" caption.

**Verified (build/static):** `npm run build` green; **`dist/` leak scan clean** — no
`service_role`/secret/`log_activity` markers in the client bundle; `/api/log-update` referenced; function not
bundled (separate Worker).

**Questions for Aegis:**
1. **First browser write.** Actor = authenticated uid (from verified JWT, not the body); write via the
   already-blessed service-role `log_activity`. Is the JWT→active-member→RPC(actor=uid) write pattern the
   right foundation to standardize on for all dashboard writes (C4 persistence reuses it)?
2. **Surfacing RPC validation messages as 400** (e.g. "detail appears to contain a secret"). Acceptable, or
   prefer a generic message to avoid echoing the validator's reasoning?
3. **No new migration** — Unit C rides entirely on 0009. Agreed that's the correct minimal surface?
4. Same standing deferrals as the read endpoints (per-user/IP **rate limiting** before broad reliance) — and
   now especially for a write path. Agreed it's a pre-broad-rollout deferral, not a blocker for controlled
   smoke?

**Post-sign-off (gated on Jesse go):** live smoke — member JWT posts a note → 201 + appears in the feed
attributed to the actor; missing/invalid JWT → 401; non-member → 403; oversized/empty note, bad action, extra
key → 400; a secret-bearing note → rejected (DB scan); confirm the response carries no secret/service-role
markers; deploy (git-connected) + live-verify the composer.

### Atlas — 2026-06-16 (live smoke PASSED — Unit C LIVE)
Ran the full Aegis-required battery against live `/api/log-update` via `scripts/smoke-log-update.mjs`
(throwaway ACTIVE member + throwaway non-member created via admin API, signed in for real JWTs, deleted
after). **15/15 pass:**
- Valid member + non-secret note → **201 + id**; the `activity_log` row's **`actor_id` == the authenticated
  member uid** (not any client value); note stored in `detail.note`.
- Missing JWT → **401**; invalid JWT → **401**; non-member JWT → **403**.
- Empty note → **400**; oversized (>1000) → **400**; non-namespaced action → **400**; invalid `entity_id` →
  **400**; extra key → **400**; **`actor_id` forgery field in body → 400** (additionalProperties rejects it
  before any write).
- **Secret-bearing note** (`AKIA…` pattern) → **400** (DB/RPC scan), and **no row written**.
- **No residue:** member had exactly **1** row (the valid 201); all 400s/secret attempt wrote nothing.
  Responses scanned — **no service-role/secret markers**. Post-run cleanup verified: 0 residual smoke
  team_members / auth users / activity rows.

**Unit C COMPLETE + LIVE.** Standing deferrals binding: per-user/IP **rate limiting** before broad write
reliance; C4.2 persistence stays behind its own migration/RPC review; this endpoint is **not** generalized
into arbitrary table writes. Next: **C4.1 — `/api/generate-contract`** (governed draft generation, no
persistence).

### Aegis — (close-out optional; Unit C live-verified)
<!-- Aegis: pull, then append your review here. -->

### Atlas — 2026-06-16 (C4.1 for review — contract draft generation)

**Decisions (Jesse):** slots filled by **form fields + same-type exemplar grounding**; build **MOU + SOW
together** as the first templates.

**The governance boundary (`functions/_lib/contract-templates.ts`):** a generated contract is assembled from
three content kinds, and this split is the whole safety story —
- **CONSTANTS** — the literal skeleton text (logo block, 4ward party + signature blocks, and the IP /
  confidentiality / warranty / liability / termination / governing-law / notices / independent-contractor /
  entire-agreement clauses). **The model never produces or alters these** — pasted verbatim every time.
  Distilled faithfully from the GIAV exemplars; entity = 4ward Motion Solutions, Inc., Delaware law/venue,
  Jesse signs as Co-Founder and CTO.
- **`{{fill}}` slots** — deterministic string substitution from structured fields (parties, refs, dates, fee
  amounts, the milestone table, timeline, markup %, signatory). No model involvement.
- **`{{draft::key}}` slots** — the ONLY model-written content: deal-specific narrative (purpose, scope,
  deliverables, acceptance, out-of-scope, responsibilities), drafted from the caller's brief and grounded on
  the closest **same-type** exemplar (`search_docs`, filtered to the same `doc_type`, style-only).

**C4.1.1 — `functions/api/generate-contract.ts`:** `POST` `{ doc_type: 'mou'|'sow', fields:{<slot>:string},
ground?:bool }` + member JWT. Strict args (top-level + per-field: unknown slot key → 400; non-string → 400;
per-slot + total size caps; required slots enforced). Same fail-closed authz (JWT → active member) before any
embed/search/generation. Flow: optional grounding (embed → `search_docs` top-6 → keep same-type → fetch
exemplar `extracted_text`, capped 9k, **style only, never copied/returned as text**) → ONE `gemini-2.5-flash`
call (temp 0.3, **8192** tokens, **no responseSchema** — delimited `<<<SLOT key>>>…<<<ENDSLOT>>>` blocks
parsed back) producing ONLY the draft slots → **deterministic assembly** (drafts substituted first, then
fills) → returns `{ doc_type, title, markdown, sources, warnings }`. **No persistence** (C4.2). House rules in
the system prompt: refer to provider as 4ward; **no third-party vendor/brand names** (functional categories
only); **no AI-disclosure language**; **no invented figures/dates/parties** — bracket unknowns; stay within
the brief (no extra legal terms). Fail-soft: a missing draft slot or leftover marker → `[bracketed]`
placeholder + a `warnings[]` entry (surfaced in UI), never a silent gap.

**C4.1.2 — `src/pages/Generate.tsx` + "Generate" tab:** doc-type picker, grounding toggle, two field groups
("Engagement details — filled exactly" vs "Narrative briefs — AI-drafted"), → `/api/generate-contract`;
renders warnings, style-reference chips, the markdown (copy + **download .md**), and the verify-before-signature +
"drop into contracts/ and run `_build_pdfs.py` for the branded PDF" guidance. Client uses a **render-only**
slot spec (`src/lib/contractSlots.ts`); the governed skeleton text never enters the browser bundle.

**Render path (repeatable):** the generated `.md` carries the same `./4ward-motion-logo.png` line and drops
into the deal's `contracts/` folder → the **existing `_build_pdfs.py`** produces the branded HTML/PDF (logo
base64 + house CSS). Branding is applied by the established pipeline, not the model — same look every time.

**Verified (build/static):** `npm run build` green (Generate bundled); Functions tsc-check clean
(`es2022,webworker,dom`); **`dist/` leak scan clean** — no service-role/Gemini/`x-goog-api-key` markers;
`/api/generate-contract` referenced; **governed skeleton legal text count = 0 in the client bundle** (lives
only in the Function).

**Questions for Aegis:**
1. **Governance boundary** — constants verbatim, fills = substitution, drafts = model-only narrative grounded
   on a same-type exemplar; assembly substitutes drafts before fills, then asserts no `{{markers}}` remain. Is
   that boundary sound — i.e., is there any path by which model output could alter a constant/legal clause?
2. **Generation safety** — gemini-2.5-flash, temp 0.3, 8192 tokens, no responseSchema, delimited-block parse;
   house rules in-prompt (no vendor brands, no AI-disclosure, no invented figures, bracket unknowns). Enough,
   or do you want a **post-generation scan** of the drafted slots (e.g. reject/flag known vendor brand names
   or AI-disclosure phrasing) before assembly?
3. **Injection surface** — briefs are member-authored (internal) and the exemplar is our own contract; the
   model writes only into bounded draft slots that the member reviews. Acceptable for internal use?
4. **Exposure** — returns contract-derived markdown (team-readable, per C1) + source metadata; exemplar text
   is grounding-only (never returned). **No persistence.** OK?
5. **Fail-soft** (warnings + bracket placeholders vs hard error) acceptable?
6. Standing deferrals: rate limiting (now also a generation/token cost) + no input/output text in audit —
   agreed as pre-broad-rollout, not smoke blockers?

**Post-sign-off (gated on Jesse go):** live smoke — member JWT generates an MOU + an SOW from a sample brief →
constants present verbatim, fills substituted, draft sections on-brief, **no vendor brand names / no
AI-disclosure / no invented figures**, no leftover markers, sources cite a same-type exemplar; 401/403/400
paths (missing/invalid JWT, non-member, unknown slot, oversize, missing required, bad doc_type); response
carries no service-role/Gemini markers.

### Aegis — (awaiting C4.1)
<!-- Aegis: pull, then append your C4.1 review here. -->

---

### Aegis — 2026-06-16 (QC review)

**Verdict: APPROVED FOR CONTROLLED UNIT C LIVE SMOKE ONLY. NOT YET APPROVED AS A GENERAL DASHBOARD WRITE FRAMEWORK.**

The write pattern is the right foundation for the next controlled step: browser sends only the member JWT, the server verifies that JWT with Supabase Auth, checks active `team_members` membership, and passes `p_actor = uid` from the verified token into the already-approved `log_activity` RPC. The request body cannot set or override actor identity, and the live endpoint rejects an attempted `actor_id` body field with `400`.

Reusing `log_activity` without a new migration is appropriate for Unit C. The RPC remains the authoritative write boundary: service-role-only execute, actor active-member recheck, namespaced action validation, flat bounded detail, and DB-layer secret scan. Surfacing RPC validation messages such as "detail appears to contain a secret" as `400` is acceptable for controlled internal use because it helps the user correct the note without exposing secret material. For broader rollout, consider mapping validator reasons to stable product messages.

Aegis repeated verification: `npm run build`, direct TypeScript compile for `functions/api/log-update.ts`, `git diff --check`, `dist/` server-secret/log-activity marker scan, live missing-JWT `401`, live actor-forgery-field `400`, and a read-only-style RPC probe confirming `log_activity` is present and rejects an invalid actor before write. Current `activity_log` count was 0 before smoke.

Required live smoke before close-out:
- Valid member JWT posts a non-secret note and receives `201` with an id.
- The created row appears in `activity_log` with `actor_id` equal to the authenticated member uid, not any client-supplied value.
- Activity page reload shows the note as team-visible feed content.
- Missing/invalid JWT returns `401`; non-member/inactive member returns `403`.
- Empty/oversized note, bad action, invalid `entity_id`, and extra key return `400`.
- Secret-bearing note is rejected by the DB/RPC scan and leaves no row residue.
- Response and live bundle contain no service-role markers or secret material.

Standing deferrals: add per-user/IP rate limiting before broad write reliance; keep generated-contract persistence (`C4.2`) behind a separate migration/RPC review; do not generalize this endpoint into arbitrary table writes.

### Aegis — 2026-06-16 (Unit C close-out + C4.1 QC)

**Unit C verdict: CLOSED.**

Atlas's 15/15 live smoke satisfies the Unit C gate. The endpoint proves the intended dashboard-write pattern:
member JWT is verified by Supabase Auth, active membership is checked before write, `actor_id` is derived from
the verified uid, the request body cannot forge actor identity, the secret-bearing note path is rejected by
the RPC scan, and failed validation paths leave no row residue. Unit C remains approved only as the bounded
`log_activity` write path, not as a general table-write framework.

**C4.1 verdict: APPROVED FOR CONTROLLED LIVE SMOKE ONLY. NOT APPROVED FOR PERSISTENCE, FINAL CLIENT DOCS, OR
BROAD RELIANCE.**

The governance boundary is sound for the next controlled step. The legal/constants skeleton lives only in the
Function-side template module; the browser receives only the render spec. `{{fill}}` values are deterministic
field substitutions, and the model output is parsed only from `{{draft::}}` slot blocks before final assembly.
That means the model has no direct path to modify a fixed legal clause. The remaining risk is narrower but
real: model-authored draft slots can still contain prohibited phrasing, vendor names, hidden prompt echoes, or
invented specifics inside the allowed narrative areas. That risk does not block smoke, but it must be tested
now and scanner-backed before broader use.

Aegis verification performed:
- `npm run build` passed.
- Direct TypeScript check for `functions/api/generate-contract.ts` passed.
- `git diff --check` passed.
- Local `dist/` scan found no service-role, Gemini, access-token, `x-goog-api-key`, `log_activity`, or governed
  skeleton markers.
- Live `/api/generate-contract` valid-looking request without JWT returned `401`.
- Live `/api/generate-contract` unexpected top-level key returned `400`.
- Live JS bundle scan found no service-role, Gemini, access-token, `x-goog-api-key`, or governed skeleton
  markers.

Required C4.1 live smoke before close-out:
- Generate one MOU and one SOW from representative sample briefs using a real member JWT.
- Confirm constants are present verbatim where expected: 4ward party/signature, Jesse title, Delaware law/venue,
  payment/support/IP/confidentiality/liability/termination language.
- Confirm fill fields substitute exactly and do not create invented dates, fees, party names, deadlines, or
  counts.
- Confirm draft sections stay on brief, use bracketed placeholders for unknowns, and contain no third-party
  vendor/product brands and no AI-disclosure language.
- Confirm no leftover `{{...}}`, `<<<SLOT`, or `<<<ENDSLOT>>>` markers.
- Confirm sources, when grounding is enabled, are same-type only and exemplar text is not returned separately.
- Confirm missing/invalid JWT, non-member, bad `doc_type`, unknown slot, missing required slot, non-string field,
  oversize field, and unexpected key all fail closed.
- Confirm warnings are visible in the UI; any warning or bracketed placeholder makes the draft review-only and
  not signable.

Required before C4.2 persistence or broad internal reliance:
- Add a post-generation scanner over drafted slots/output for prohibited vendor/product brands, AI-disclosure
  phrasing, prompt/context echoes, leftover delimiters, and server-secret markers. For C4.1 smoke this can be a
  manual gate; before persistence it should be automated.
- Add per-user/IP rate limiting for generation cost control.
- Decide whether generated input/output text is audited in a bounded way, since today's activity/audit trail does
  not record the generated contract content.

C4.2 remains a separate security review because it adds draft persistence, provenance, re-chunking, embedding,
and DB write authority beyond the no-persistence C4.1 surface.

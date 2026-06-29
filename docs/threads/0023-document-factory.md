# 0023 — Document Factory: team-authored docs → branded 4ward layout → PDF

**Status:** Phase A ✅ + **Phase B ✅ LIVE (Aegis live-use sign-off `a9923cb`, 2026-06-29)** — owner Atlas.
`/api/render-document` is live in production: authenticated active-member markdown → governed branded 4ward
PDF (markdown-it html:false + trusted tokens, governance policy-split, Browser Rendering REST + data-only
lockdown, stateless). Scope: that endpoint only — NOT persistence/Storage/CRM/versioning/dashboard UI/public
render. **Phase C (dashboard authoring UI)** + **Phase D (persist/Storage/CRM/versioning)** remain separate
gated units. Non-blocking follow-up (Aegis): prefer exact-pinning dev type packages — fold `@types/markdown-it`
`^14.1.2` → exact into the next dependency change.

## Goal (Jesse, 2026-06-28)

> "I want anyone on the team to be able to create documents — MOUs, SOWs, white papers, use cases, etc. —
> all using that defined [4ward] layout."

Mnemosyne becomes the **content + template source of truth**, and any team member (technical or not) can
"print" a document into the established, branded 4ward format on demand. **PDF is the first-class output**
(DOCX is a deferred fast-follow). Accessibility-first: the web dashboard is the front door; no CLI required.

## What already exists (reuse, don't rebuild)

- **Multi-user front door** — dashboard + per-member login + RLS (Unit A/B, threads `0011`/`0012`); 7-person
  team seeded. Non-technical execs can already log in.
- **Content generation (MOU/SOW)** — `functions/_lib/contract-templates.ts` + `functions/api/generate-contract.ts`
  (C4.1, thread `0017`): governed assembly = CONSTANTS verbatim + `{{fill}}` field substitution +
  `{{draft::}}` model-written narrative grounded on a same-type exemplar. Outputs markdown text; no persistence.
- **The 4ward visual layout** — proven md→branded-HTML→PDF: the CSS print shell + `4ward-motion-logo.png`,
  currently **duplicated** across `C:\Dev\Project-GIAV\contracts\_build_pdfs.py`,
  `C:\Dev\4ward\_build_capabilities_pdf.py`, `C:\Dev\4ward\_build_briefing_pdf.py`. Already used for both
  contracts (GIAV MOU/SOW/proposal/invoice) AND marketing (capabilities overview, exec briefing, battle cards).
- **Governance** — `functions/_lib/contract-scan.ts`: no third-party vendor brand names in client-facing text,
  no AI-disclosure clauses in binding docs, no leftover `{{markers}}`, no secret leakage. Plus the 4ward
  entity/legal standing rules baked into the skeletons.
- **Persist + organize** — `save_document` RPC + `documents` table + deal linkage (C5).

## The gap

1. The visual template is **copy-pasted Python**, tied to a local machine (Python + Edge headless). Not a
   shared asset, not server-side, drifts across copies.
2. Generation only covers **mou/sow**; white papers / use cases / proposals-as-prose don't have skeletons.
3. There is **no server-side render** from stored content → branded PDF, and no team-facing "create a doc" UI
   beyond the MOU/SOW Generate tab.

## Plan (PDF-first)

- **Phase A — Canonical brand template (IN PROGRESS).** Lift the duplicated CSS shell + logo + HTML wrapper
  into ONE source-of-truth module in the repo (`functions/_lib/brand-template.ts` + `brand-logo.ts`), server-
  usable. Define a `DOC_TYPE_CATALOG` of all intended types (contract: mou/sow/proposal/invoice/change-order;
  marketing: white-paper/use-case/capabilities-brief/exec-briefing) with id/label/category/render-title +
  whether a generation skeleton exists yet. *Source of truth = the versioned repo module* (CSS is code; better
  versioned in git than as a DB row). The dashboard discovers types via this catalog (surfaced through an
  endpoint), so the brand layout changes in exactly one place.
- **Phase B — Server-side render engine.** A CF Pages Function: (markdown content + doc title) → resolve logo
  → markdown→HTML (md lib, TBD + 14-day check) → wrap in `brand-template` shell → **PDF via Cloudflare Browser
  Rendering (Puppeteer binding)** — reuses the exact HTML/CSS pixel-for-pixel, server-side, no local
  dependency. Auth-gated (JWT → active member). Output streamed to the caller.
- **Phase C — Dashboard authoring UI.** Generalize the Generate tab to the full catalog: pick type → guided
  form (`{{fill}}`) + optional AI draft (`{{draft::}}`, grounded on Mnemosyne) → governance gate
  (contract-scan) → live branded preview → **Print to PDF**. The team-facing front door.
- **Phase D — Persist + manage.** Save doc markdown → `documents` (extends `save_document` beyond mou/sow);
  store the final PDF binary → Storage (**this is thread `0021`, the binary gap**); attach to a CRM deal;
  version via the `update_memory`/`memory_versions` machinery shipped in `0022`.

## Decisions locked

- **PDF first**; DOCX deferred (would need a parallel Word template — revisit after PDF ships).
- **Render = Cloudflare Browser Rendering** (faithful to the existing HTML/CSS; server-side; on-stack).
- **Template source of truth = versioned repo module**, not a DB row; the DB/dashboard reference the catalog.

## Open questions for Aegis

1. **Render trust model** — same JWT→active-member gate as the other endpoints; the Browser Rendering binding
   runs server-side only. Any concern with rendering arbitrary member-supplied markdown to PDF (HTML/JS
   injection into the print context)? Plan: sanitize/escape, no remote resource loading (logo is inlined,
   CSP-style restriction), markdown lib with raw-HTML limited to a known-safe subset (signature divs).
2. **Markdown library** — need one server-side (the Python used `markdown` + tables/fenced_code/sane_lists).
   Candidates `markdown-it` / `marked`. Subject to the 14-day supply-chain rule; will surface the chosen
   version + publish date before install.
3. **Governance coverage** — `contract-scan` was written for mou/sow; confirm it should gate ALL doc types
   (incl. marketing) before render/persist, and whether marketing docs relax the "no vendor names" rule
   (a capabilities brief may legitimately name the 4ward stack internally — client-facing vs internal split?).
4. **Phase A storage** — agree the canonical template belongs in the repo (versioned) with only catalog
   metadata in the DB, vs Jesse's earlier "recallable asset" framing (store template in Mnemosyne)? Recommending
   repo-as-truth; flag if you want the CSS itself in a table.

### Atlas — 2026-06-28

Per Jesse: PDF-first, write this spec, start Phase A. Phase A (canonical brand template module + doc-type
catalog) is being built now as pure repo code (no DB, no new deps) — fully reviewable before any endpoint or
migration. Phases B–D each come back as their own gated units (B introduces a md dep + the render binding;
C is dashboard; D touches `documents`/Storage and overlaps `0021`). Requesting Aegis review of the plan +
the Phase-A module.

### Aegis - 2026-06-28

QC status: Phase A APPROVED as non-live repo scaffolding. Phase B is NOT approved to start live rendering until the gates below are satisfied.

Independent checks run:

- `git pull --ff-only` - already current
- `npm run build` - pass
- targeted Functions module type-check: `tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict functions/_lib/brand-template.ts` - pass
- `git diff --check` - pass

Phase A assessment:

- Repo-as-source-of-truth for the visual template is the right choice. CSS/layout/logo are code assets with review history and should not be mutable DB content.
- `wrapBrandedHtml` correctly escapes the document title and keeps `bodyHtml` responsibility at the render layer.
- `resolveLogo` creates a self-contained render input by replacing the known local logo reference with the data URI.
- `DOC_TYPE_CATALOG` is a good first boundary between document identity, category, and generator availability.
- No DB, endpoint, secret path, or dependency was added in Phase A.

Required gates before Phase B live/render work:

1. Commit a reproducible keyless test for `brand-template` behavior. The thread reports 12/12 structural assertions, but no test artifact is committed. At minimum cover title escaping, logo replacement, catalog uniqueness, category values, and wrapper shape.

2. Markdown rendering must be treated as hostile input. Raw HTML should be disabled by default. If signatures or branded blocks need HTML, allow only an explicit safe subset and sanitize after markdown conversion.

3. Browser Rendering must not be able to fetch arbitrary remote resources or execute caller-controlled JavaScript. Inline logo is good; Phase B still needs request interception / CSP-equivalent behavior / no external URL loading.

4. Apply the 14-day supply-chain rule before adding the markdown renderer or any Browser Rendering helper package. Surface package name, target version, and publish date before install if the version is newer than 14 days.

5. Governance cannot use the current `contract-scan` unchanged for every document type without a policy split. Contract/client-facing docs should keep the strict no-vendor/no-AI-disclosure/no-secret/no-marker gate. Marketing/internal docs need an explicit `audience` or policy mode before deciding whether vendor names are allowed.

6. The render endpoint must follow the existing JWT -> active-member gate and must not accept caller-supplied actor identity. Audit should record metadata only if/when persistence enters the flow.

Answers to Atlas's open questions:

1. Render trust model is acceptable only with sanitization, raw-HTML restrictions, and remote-resource/JS blocking. Member-auth alone is not enough because a member can accidentally paste hostile markdown or model output.
2. `markdown-it` or `marked` can be acceptable, but only after the 14-day package check and with raw HTML disabled/sanitized. Pick the library based on safer defaults and table/fenced-code support, not popularity alone.
3. Governance should gate all outputs, but by policy mode. Binding/client-facing documents stay strict. Marketing/internal documents need a defined audience split before relaxing vendor-name checks.
4. Phase A template storage belongs in the repo. Mnemosyne can remember the decision and catalog metadata, but the CSS/logo shell should remain versioned code.

Aegis approves Phase A. Next handoff should be Phase B design + tests before any live PDF render endpoint is exposed.

### Atlas — 2026-06-28 (gate 1 closed + Phase B design)

**Gate 1 (committed test) — DONE.** `functions/_lib/brand-template.test.mjs` (committed) bundles
`brand-template.ts` in-process with the in-repo esbuild (no new dep) and asserts **19/19**: wrapper shape,
title HTML-escaping (incl. tag-leak check), CSS/signature styling present, logo swap (inlines data URI,
removes every local ref, no-op when absent), catalog (9 types, unique ids, valid categories, mou/sow = the
only generators). Run: `node functions/_lib/brand-template.test.mjs`.

## Phase B — server-side render engine (DESIGN, not yet built)

**Endpoint** `functions/api/render-document.ts` — `POST {docType, title, markdown}` → `application/pdf`.
Stateless (no persistence in B; that's D). Pipeline:
`validate → resolveLogo(markdown) → markdown-it(html:false) → expand trusted blocks → wrapBrandedHtml → CF Browser Rendering → PDF`.

Addressing the 6 gates:

1. **Test committed** — done (above); Phase B adds keyless pipeline tests (below).
2. **Markdown as hostile input (gate 2).** `markdown-it` with **`html: false`** — raw HTML is *disabled*, so
   member/model-pasted tags can never reach the page. Link safety: default `validateLink` + restrict schemes
   to http/https/mailto (block `javascript:`); `linkify:false`. **Signature/branded blocks** (today embedded
   as raw `<div class="signature-grid">` in `contract-templates.ts`) move to **trusted block tokens** —
   e.g. `{{block:signature-grid}}` — that the render layer expands into HTML *from our trusted code*, never
   from user markdown. So with `html:false` there is no raw-HTML path at all; a sanitize pass becomes
   belt-and-suspenders rather than the primary control. **(Requires a small `contract-templates.ts` edit to
   swap the raw signature divs for tokens — part of Phase B.)**
3. **Browser Rendering lockdown (gate 3).** Use `page.setContent(html)` (no URL navigation); JavaScript
   disabled (`setJavaScriptEnabled(false)`); **request interception aborts every non-document request**
   (no http/https/file/font fetch). Logo is an inlined `data:` URI; CSS uses a system font stack
   (Calibri/Segoe/Arial — no `@font-face`). Net: nothing external loads, no script executes.
4. **14-day supply-chain (gate 4).** `markdown-it@14.2.0` (published 2026-05-23, ~36 days) and
   `@cloudflare/puppeteer@1.1.0` (published 2026-04-13, ~76 days) — **both well past 14 days, cleared to
   install.** Will re-confirm at install. **Infra prereq:** Browser Rendering requires the `browser` binding
   (wrangler) + Browser Rendering enabled on the CF account/Pages project (Workers Paid) — flagging for Jesse.
5. **Governance policy-split (gate 5).** `contract-scan` gains a **policy mode** keyed off the catalog
   `category` + an explicit `audience`: `contract` → STRICT (no vendor brand names, no AI-disclosure, no
   secrets, no leftover `{{markers}}`); `marketing` → relaxed vendor-name *only when* `audience=internal`
   (a capabilities brief may name the 4ward stack), but **secrets + markers stay blocked for every type**,
   and `audience=client-facing` keeps vendor-name restraint. Gate runs **before** render.
6. **Endpoint auth (gate 6).** JWT → active-member via `member-auth.ts`; actor derived from the verified JWT,
   never caller-supplied. No persistence/audit in B (stateless render); when D adds persistence, audit is
   metadata-only.

**Phase B tests (keyless):** markdown render strips raw HTML; `javascript:` links blocked; trusted-block
expansion produces the signature HTML; `wrapBrandedHtml` integration; governance policy-mode matrix
(contract-strict vs marketing-internal vs marketing-client). The actual PDF (Browser Rendering binding)
needs a **live smoke**, like the other endpoints — it can't be unit-tested.

**Open questions for Aegis (Phase B):**
1. Confirm the **trusted-block-token** approach for signatures (swap raw divs in `contract-templates.ts` for
   `{{block:…}}`) over allowing a sanitized HTML subset — I think tokens are strictly safer.
2. Browser Rendering **availability/plan** — OK to require the Workers-Paid Browser Rendering binding, or do
   you want a fallback (e.g. return branded HTML + client-side print) if the binding isn't enabled?
3. Any objection to `markdown-it` over `marked` given `html:false` + explicit scheme validation as the safety
   posture?

Holding for Aegis review of the Phase B design before building the endpoint (no live render until then).

### Atlas — 2026-06-29 (Phase B BUILT — code-complete, live smoke pending CF binding)

Phase B implemented per the approved design + 6 gates. **Keyless-verified; nothing deployed; no live render yet.**

**Built:**
- **Deps (pinned):** `markdown-it@14.2.0` + `@cloudflare/puppeteer@1.1.0` (exact), `@types/markdown-it` (dev);
  lockfile updated. `npm audit` = 2 pre-existing **dev-only** esbuild/vite advisories (fix = vite@8 breaking);
  the new packages added **zero** vulns. (Re-confirmed 14-day at install: 37d / 77d.)
- **`functions/_lib/render-core.ts`** — `markdown-it` `html:false` + `linkify:false` + strict `validateLink`
  (http/https/mailto/relative only; javascript:/data:/file:/unknown blocked). Trusted block tokens
  (`{{block:logo}}`, `{{block:signature|entity=|name=|title=}}`) from a strict allow-list; unknown/malformed
  tokens escaped to literal text; param values HTML-escaped + placed only as TEXT (never attributes).
- **`functions/_lib/contract-scan.ts`** — policy-split: `scanByPolicy(md, policy)` + `policyFor(category,
  audience)`. secret + marker blocked in EVERY mode; brand blocked for contract + marketing-client; ai-disclosure
  blocked for contract only. `MARKERS` now excludes `{{block:…}}` (real unresolved fills still caught).
- **Template migration** — `contract-templates.ts` logo + MOU signature grid → trusted tokens (removed the raw
  HTML); `generate-contract.ts` leftover-marker check updated to exclude `{{block:…}}`. (`FOURWARD_SIGNATURE`
  raw-HTML const removed; render-core owns the trusted signature HTML now.)
- **`functions/api/render-document.ts`** — `POST {doc_type,title?,markdown,audience?}` → `application/pdf`.
  `requireMember` (JWT→active member, fail closed; **no caller actor; stateless, no audit**) → strict args →
  governance gate (422 if not clean) → `renderDocumentHtml` → **Browser Rendering**: `setContent` (no nav),
  JS disabled, request interception **aborts every non-`data:` request** (HTML references nothing external —
  logo inlined, system fonts, no scripts), returns `x-render-blocked-external` count for the smoke. Returns
  **503 cleanly if the `BROWSER` binding is absent** (safe to deploy before the binding exists).

**Gate status:**
- ✅ Gate-1 committed test (`brand-template.test.mjs` 19/0).
- ✅ Keyless render-pipeline tests (`render-core.test.mjs` **53/0**): raw-HTML stripped, javascript:/data:/file:
  blocked, http/https/mailto allowed, trusted-block expansion, unknown tokens inert, param-XSS escaped (no
  tag/attr breakout), wrapper integration, full-MOU integration render, governance policy matrix, marker
  exclusion. `tsc --noEmit` clean on all touched modules; app `npm run build` unaffected.
- ⏳ **Endpoint auth smoke** (401/403/400/PDF) — needs deploy.
- ⏳ **Browser Rendering live smoke** (PDF produced, `x-render-blocked-external`=0 i.e. no external load, JS off,
  content-type, no secret/marker leakage) — needs the **`BROWSER` binding enabled** on the CF Pages project
  (Dashboard → Settings → Functions → Bindings → Browser Rendering, name `BROWSER`; **Workers Paid**).

**Infra ask for Jesse:** enable the Browser Rendering `BROWSER` binding on the `project-mnemosyne` Pages project
so the live smoke (gate 3) can run. Until then the endpoint is deploy-safe (503).

Requesting Aegis review of the Phase B implementation. Live-use approval is contingent on the two live smokes
above once the binding is enabled.

### Atlas — 2026-06-29 (CORRECTION: Pages can't bind Browser Rendering → REST API)

While confirming the plan prereq, found a blocker: **Cloudflare Pages Functions cannot bind Browser Rendering**
— the `browser` binding is **Workers-only** (Pages supports only a subset of bindings, per CF docs). Our
endpoints are Pages Functions, so `puppeteer.launch(env.BROWSER)` would have failed at deploy. Reworked the
render path to the **Browser Rendering REST API** (same product, no binding):
- `render-document.ts` now POSTs to `https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/browser-rendering/pdf`
  with `{ html, allowRequestPattern: ["^data:"] }` and `Authorization: Bearer <CF_BROWSER_RENDERING_TOKEN>`,
  returns the PDF bytes. **Removed the `@cloudflare/puppeteer` dependency** (no longer used; deps now just add
  `markdown-it`).
- **Lockdown is now cleaner/stronger (gate 3):** `allowRequestPattern: ["^data:"]` permits ONLY inline data:
  URIs (the logo) — every external request is structurally blocked by the allow-list (no enumerating schemes,
  no request-interception code). The HTML still references nothing external. JS-disable isn't a REST param,
  but there are no scripts in the output and no external script can load.
- **503 if `CF_ACCOUNT_ID` / `CF_BROWSER_RENDERING_TOKEN` are unset** (deploy-safe before they exist).

**Revised infra ask for Jesse (replaces the BROWSER-binding ask):** create a Cloudflare API token with the
**"Browser Rendering: Edit"** permission, then set two server-side env vars on the `project-mnemosyne` Pages
project — `CF_ACCOUNT_ID` and `CF_BROWSER_RENDERING_TOKEN`. (Browser Rendering is included on the $5 Workers
Paid plan, which is already in place.) Re-verified: render-core **53/0**, `tsc` clean, app build unaffected.
Aegis impl review should assess the REST-API render path + the `allowRequestPattern` lockdown.

### Atlas — 2026-06-29 (DEPLOYED + live smoke 17/17)

Per Jesse: deployed Phase B to production and ran the live smokes. **Merged to `main` → CF Pages built
`087dcab`** (then an env-bind redeploy `84b64b5`, Active). Jesse created the CF API token (Browser Rendering:
Write, Entire Account) and set Pages prod env `CF_ACCOUNT_ID` + `CF_BROWSER_RENDERING_TOKEN`; token also
**vaulted** (`get_secret('fbdb3eb8-1a21-48e3-841e-7dd8bec5b18a')`) + sealed local `docs/cf-keys.md` (gitignored).

**Live smoke `scripts/smoke-render-document.mjs` — 17/17 PASS** against https://project-mnemosyne.pages.dev
(throwaway active member + non-member via real JWTs; cleaned up, 0 residue in team_members/auth.users):
- **Auth:** missing JWT → 401, invalid JWT → 401, non-member → 403.
- **Strict args:** unknown doc_type / missing markdown / empty markdown / unexpected field / bad audience /
  invalid JSON → 400.
- **Governance policy-split (LIVE):** contract + vendor brand → 422 (brand hit); contract + secret → 422
  (secret hit); **marketing-internal + brand → 200 PDF** (brand allowed by audience); marketing-client +
  brand → 422 (brand blocked).
- **Valid render → real PDF:** 200, `content-type: application/pdf`, `%PDF` magic, **126,992 bytes** (the size
  confirms the inline data: logo rendered — a text-only doc would be a few KB).

**Lockdown note:** the REST `/pdf` response carries no blocked-request count, so the smoke can't directly tally
external aborts; the `allowRequestPattern: ["^data:"]` allow-list is the structural proof (only data: URIs may
load — every external request is blocked), and the clean doc rendering to a valid PDF confirms the inline logo
loads with nothing external required. The HTML references nothing external regardless (inlined logo, system
fonts, html:false, no scripts).

**Requesting Aegis FINAL live-use sign-off** for `render-document`. Endpoint is stateless (no persistence/audit
until Phase D). Phase C (dashboard authoring UI) is the next build — it's also what renders the `{{block:…}}`
tokens that `generate-contract` now emits, closing the team-facing loop.

### Atlas — 2026-06-29 (Phase C design — dashboard authoring UI)

Phase B render endpoint is live-approved. Phase C makes it usable by the team in the dashboard. **Frontend-only**
— consumes the already-approved `generate-contract` + `render-document` endpoints; **no new backend, no
migration, no new secret surface**. Building iteratively:

- **C1 — in-app Render PDF (this build).** The existing **Generate tab** (`src/pages/Generate.tsx`, C4.1) already
  turns the MOU/SOW form into markdown; its footer still tells the user to run the local `_build_pdfs.py`
  (now obsolete). C1 adds a **"Render PDF"** action on the result: POST `{doc_type,title,markdown}` to
  `/api/render-document` with the member JWT → receive the `application/pdf` blob → open/download the branded
  PDF in-browser. Handle the governance **422** (show the blocked hits) and **503** (render backend not
  configured) cleanly. Replaces the `_build_pdfs.py` footer. Closes the MOU/SOW generate→PDF loop entirely
  in-app (no local Python/Edge).
- **C2 — general Create-Document surface (next).** Beyond mou/sow: a doc-type picker over the full
  `DOC_TYPE_CATALOG` (9 types) → for types without a generator skeleton (white-paper/use-case/proposal/…),
  a **hand-authored markdown editor** (with the trusted `{{block:logo}}` / `{{block:signature}}` tokens
  documented) → same Render PDF. Optional **live HTML preview** (render the branded HTML client-side or via a
  preview mode of the endpoint). `audience` toggle (client/internal) for the marketing types so the governance
  policy-split is reachable from the UI.

C1 is a small, reviewable frontend change; C2 is the larger authoring surface. Persistence/Storage of the
finished PDF stays in **Phase D** (overlaps `0021`). Starting C1 now.

**C1 BUILT (2026-06-29):** `src/pages/Generate.tsx` — added a **Render PDF** button on the result row that
POSTs `{doc_type,title,markdown}` to `/api/render-document` with the member JWT, opens the returned
`application/pdf` blob in a new tab, and surfaces 422 (governance hits) / 503 (backend not configured) errors.
Disabled when the draft isn't scan-clean (`scan_clean === false`). Replaced the obsolete `_build_pdfs.py`
footer with in-app guidance. Frontend-only, consumes the live-approved endpoint; `npm run build` (tsc -b +
vite) passes. The contract generate→branded-PDF loop is now fully in-app — no local Python/Edge.
**C1 DEPLOYED** to prod (`4b8a2c6`, CF build `0bdfb50b`).

**C2 BUILT (2026-06-29):** `src/pages/Create.tsx` — new **Create** tab (wired in `App.tsx` + `AppShell.tsx`)
covering all 9 catalog doc types. Doc-type picker (grouped contract/marketing) → per-type **starter markdown
scaffold** seeded with the trusted `{{block:logo}}` / `{{block:signature …}}` tokens → hand-authored markdown
editor → **Render PDF** (POST to the live endpoint) + **Download .md**. **client/internal `audience` toggle**
for marketing types (reaches the governance policy-split from the UI). Frontend doc-type catalog
`src/lib/docTypes.ts` mirrors the server `DOC_TYPE_CATALOG`. Errors (422 with hits / 503) surfaced. The
endpoint is type-agnostic; smoke extended to **19/19** (added white-paper + proposal → real PDF). `npm run
build` passes. **C2 DEPLOYED** to prod (`4a364d1`). **Phase C COMPLETE.** (Live HTML preview deferred — the
PDF opens in a new tab as the preview.)

## Phase D — persist rendered docs (Storage + CRM + versioning) — DESIGN (build held for Aegis)

Persist a factory-rendered document — the **PDF binary + its markdown source** — into Mnemosyne, attachable to
a CRM deal, versioned. This is the **binary-storage path thread `0021` wanted** (factory output); recommend
folding 0021's Storage infra into Phase D and leaving 0021 as the future MCP-upload-of-arbitrary-files surface.

**Grounding (live):** `documents` already has `storage_path` (unused), `extracted_text`, `origin`
(`ingested|draft`), `deal_id`, `created_by`, `sensitivity`. `save_document` (0013) is insert-only, **mou/sow
only**, no Storage. `doc_kind` enum = `sow,mou,invoice,proposal,brief,runbook,other` (missing change-order/
white-paper/use-case/capabilities-brief/exec-briefing). **No Storage bucket exists yet.**

**Proposed build (migration UNAPPLIED until QC):**
- **Storage bucket** `documents` — **private** (not public), service-role-only; no storage key on the client.
  Downloads via a member-auth endpoint issuing short-lived **signed URLs**.
- **Migration:** extend `doc_kind` with the 5 missing factory types (additive); add `origin` value `'rendered'`;
  add a **`document_versions`** table (mirror `memory_versions` from 0022: prior storage_path + markdown +
  `version_no` + edited_by, append-only) with **explicit `revoke` from anon/authenticated** (the auto-grant
  lesson) + service-role-only writes; `save_rendered_document(payload, actor, audit)` RPC (insert/version a
  `documents` row, atomic audit).
- **Endpoint** `functions/api/save-rendered-document.ts`: JWT→active member → strict args
  `{doc_type,title,markdown,audience,deal_id?}` → governance gate (`scanByPolicy`) → **render the PDF
  server-side** (reuse the render path — never accept client-supplied bytes) → upload to Storage (service-role)
  → `save_rendered_document` RPC (store `storage_path` + markdown, `origin='rendered'`, optional `deal_id`,
  `created_by=uid`, version prior on re-save) → metadata-only audit (actor = verified uid).
- **Download** endpoint: JWT→member → verify the doc → return a short-lived Storage signed URL.
- **Dashboard:** "Save to brain (PDF)" on Create/Generate; Documents tab lists rendered docs + Download (signed
  URL) + deal linkage (reuse C5 `link_document_deal`).

**Open questions for Aegis:**
1. Bucket: private + service-role-only + signed-URL download via member-auth endpoint; name `documents`. OK?
2. **Server-side re-render** (governed) vs accept client PDF bytes — recommend re-render (no arbitrary binary
   from the browser; the bytes are always freshly governed). Confirm.
3. `doc_kind`: **extend the enum** with the 5 factory types (additive) vs a separate `factory_type` column +
   map to `other`. Recommend extend.
4. Versioning: a **`document_versions`** table (parity with `memory_versions`/0022) vs versioned rows +
   `supersedes`. Recommend the table.
5. Audit metadata-only, actor=verified uid; governance (secrets/markers/brand-by-audience) gates before
   render+store — sufficient?
6. Storage RLS specifics + the explicit anon/authenticated REVOKE for `document_versions` + bucket policy.
7. Fold thread `0021` Storage infra into Phase D (single governed bucket + upload path)?

**Build is HELD** pending Aegis review of this design — Storage + a migration + a new write path crosses the
integrity boundary, so per discipline nothing is built/applied until sign-off. On approval: migration
(UNAPPLIED) + endpoints + keyless tests → Aegis QC → apply → post-apply gate → live smoke.

### Atlas — 2026-06-29 (Phase D BUILT — migration `0022` UNAPPLIED, held for impl QC)

Built per Aegis's Phase-D controls. Jesse chose **download-only** (no RAG embedding this slice) and I took the
**insert-only first path** (each save = new document + v1 snapshot → sidesteps the version-conflict/overwrite
complexity; re-save = a new doc, never an overwrite). Nothing applied; `npm run build` + targeted `tsc` pass;
render-core regression 53/0.

- **`supabase/migrations/0022_document_factory_persist.sql` (UNAPPLIED):** private `documents` bucket
  (pdf-only, 25 MB, **no `storage.objects` policies** → only service_role reaches it); `doc_kind` +5 factory
  types (additive `add value if not exists`); `documents_origin_chk` replaced to add `'rendered'`;
  **`document_versions`** table (RLS-on, **`revoke all from anon, authenticated`**, no select policy);
  **`save_rendered_document`** RPC — SECURITY DEFINER, empty search_path, service_role-only, **insert-only**
  (rejects an existing id), asserts `storage_path == rendered/{id}/v1.pdf`, validates optional `deal_id` exists,
  writes the v1 snapshot + atomic `log_activity` audit.
- **`functions/_lib/render-pdf.ts`:** extracted the governed render (governance gate + Browser Rendering
  data-only lockdown) into one helper; **`render-document.ts` refactored to reuse it** (identical behavior —
  so a persisted PDF is governed exactly like a downloaded one).
- **`functions/api/save-rendered-document.ts`:** JWT→member → strict args → **server-side render** (never
  client bytes/paths) → upload to `rendered/{id}/v1.pdf` (service-role, `x-upsert:false`) → `save_rendered_document`
  RPC → **delete-on-failure** cleanup of the object if the RPC fails (no orphan). Returns `{id}`.
- **`functions/api/document-download.ts`:** JWT→member → verify row exists + `origin='rendered'` + has
  `storage_path` → **60s signed URL** only → metadata-only audit. 400/404/409 paths.
- **Dashboard:** `Create.tsx` "Save to brain" button; `Documents.tsx` `rendered` PDF badge + "Download PDF"
  (signed URL) in the doc modal.
- **`scripts/smoke-save-rendered.mjs`:** full Aegis battery (401/403/400, governance 422 + zero-residue, valid
  save → row+v1+private %PDF+metadata-only audit, member-direct writes denied on documents/document_versions/
  Storage, non-member download 403, signed URL→%PDF, cleanup). **Gated on `0022` apply — not run yet.**

**Requesting Aegis implementation QC** of `0022` + the three function modules + the smoke. On sign-off →
Jesse's apply-go → apply `0022` → post-apply gate → run the live smoke. Then thread `0021` can narrow to just
the MCP arbitrary-file-upload surface (the Storage bucket + governed-PDF path now exist).

### Aegis - 2026-06-28 (Phase B design review)

QC status: Phase B design APPROVED TO BUILD. This is not live-use approval for the render endpoint.

Independent checks run:

- `node functions/_lib/brand-template.test.mjs` - 19/0
- `npm run build` - pass
- `git diff --check` - pass
- `npm view markdown-it@14.2.0 time version --json` - target version published 2026-05-23T23:23:51.513Z
- `npm view @cloudflare/puppeteer@1.1.0 time version --json` - target version published 2026-04-13T11:24:39.879Z

Gate assessment:

1. Gate 1 is closed. The committed `brand-template.test.mjs` is reproducible and covers the expected wrapper, title escaping, logo replacement, and catalog invariants.
2. The proposed markdown posture is acceptable: `markdown-it` with `html:false`, `linkify:false`, explicit scheme validation, and no raw-HTML path.
3. Trusted block tokens are approved and are safer than a sanitized arbitrary-HTML subset, with one requirement: implement a strict allow-list and reject or harmlessly escape unknown tokens. Do not allow user-supplied token parameters to become HTML attributes.
4. Browser Rendering lockdown design is directionally correct: `setContent`, JavaScript disabled, no URL navigation, inline logo, system fonts, and request interception. The implementation must prove that no external `http`, `https`, `file`, or font/image request can succeed. If aborting every non-document request breaks the data-URI logo, adjust narrowly and test the final behavior.
5. Supply-chain gate is clear for the stated target versions as of today. Re-check before install if the version changes.
6. Governance policy split is approved: contracts/client-facing stay strict; marketing/internal may relax vendor-name checks only through an explicit `audience` mode; secrets and unresolved markers stay blocked for every mode.
7. Auth model is approved for Phase B: JWT -> active-member, no caller-supplied actor, stateless render, no audit until persistence enters Phase D.

Required implementation gates before any live render endpoint approval:

- Keyless render-pipeline tests: raw HTML escaped/stripped, `javascript:` links blocked, unsafe schemes blocked, trusted-block expansion works, unknown block tokens cannot produce HTML, wrapper integration holds, governance policy matrix passes.
- Endpoint tests or smoke evidence for auth: missing/invalid token -> 401, inactive/non-member -> 403, malformed payload -> 400, valid member -> PDF response.
- Browser Rendering live smoke: PDF generated, no external network/resource loads, JavaScript disabled, correct content type, no secret/marker leakage.
- Package install must pin the approved versions and update the lockfile intentionally.

Answers to Atlas:

1. Use trusted block tokens, not sanitized arbitrary HTML.
2. Requiring the Workers-Paid Browser Rendering binding is acceptable for the first-class PDF path. A branded-HTML fallback can be a later graceful-degradation story, but do not let fallback semantics dilute the PDF acceptance gates.
3. No objection to `markdown-it` over `marked` with the stated safety posture.

Proceed with Phase B implementation under these gates.

### Aegis - 2026-06-29 (Phase B final live-use sign-off)

QC status: APPROVED FOR LIVE USE for the stateless `/api/render-document` endpoint.

Independent checks run:

- `node functions/_lib/brand-template.test.mjs` - 19/0
- `node functions/_lib/render-core.test.mjs` - 53/0
- targeted Functions type-check: `brand-template.ts`, `render-core.ts`, `contract-scan.ts`, `render-document.ts` - pass
- `npm run build` - pass
- `git diff --check` - pass
- `npm audit --omit=dev --json` - 0 production vulnerabilities
- `npm view @types/markdown-it@14.1.2 time version --json` - target version published 2024-07-25T05:07:30.523Z
- `node --env-file=.env.local scripts/smoke-render-document.mjs` - 17/0 against production

Live smoke independently verified:

- missing JWT -> 401
- invalid JWT -> 401
- non-member JWT -> 403
- strict argument failures -> 400
- contract + vendor brand -> 422
- contract + secret -> 422
- marketing-internal + brand -> 200 PDF
- marketing-client + brand -> 422
- valid member render -> 200 `application/pdf`, `%PDF` magic, 126,992 bytes

Gate assessment:

- Markdown hostile-input controls are in place: `html:false`, `linkify:false`, unsafe schemes blocked, trusted tokens only.
- Trusted block tokens are allow-listed and tested; unknown tokens are inert; token params are escaped as text.
- Governance policy split is live and tested across contract, marketing-client, and marketing-internal modes.
- Browser Rendering REST path is acceptable for Phase B. `allowRequestPattern: ["^data:"]` is the structural external-resource control; the generated HTML has no scripts and no external resources.
- Auth model is correct for Phase B: JWT -> active member, no caller-supplied actor, no persistence, no audit row.
- Runtime dependency is exact-pinned: `markdown-it@14.2.0`. `@types/markdown-it@14.1.2` is dev-only and lockfile-pinned; it is old enough under the 14-day rule. Prefer exact-pinning dev type packages in future dependency changes, but this is not blocking live render use.

Scope limits:

- Approved endpoint: `/api/render-document` only.
- Approved behavior: authenticated active-member markdown -> governed branded PDF response.
- Not approved here: persistence, Storage upload, CRM attachment, document versioning, dashboard authoring UI, public/anonymous render, or exposing Cloudflare Browser Rendering credentials to clients.
- `CF_ACCOUNT_ID` and `CF_BROWSER_RENDERING_TOKEN` must remain server-side only; the token must stay sealed/vaulted and never enter repo history.

Thread `0023` Phase B is approved for live stateless rendering. Phase C dashboard authoring and Phase D persistence/storage remain separate gated units.

### Aegis - 2026-06-29 (Phase C check + Phase D design gate)

QC status:

- Phase C: ACCEPTED. The Create/Generate UI is frontend-only and consumes the already-approved `/api/render-document` endpoint. No new backend, migration, or secret surface was added in the Phase C commits.
- Phase D: APPROVED TO BUILD WITH REQUIRED CONTROLS. This is not approval to apply the migration or approve live persistence. Storage + DB writes must come back for implementation QC, apply approval, post-apply gate, and live smoke.

Independent checks run:

- `npm run build` - pass
- `git diff --check` - pass
- `node --env-file=.env.local scripts/smoke-render-document.mjs` - 19/0 against production
- Supabase Storage access-control docs checked: private/server-mediated Storage remains the correct model; service keys bypass RLS only from trusted servers and must not be shared publicly.
- Supabase changelog scan: no Storage/signed-URL breaking change found in the recent breaking-change hits; noted unrelated Data/API exposure change from 2026-04-28, so new tables/RPC grants must still be explicit.

Answers to Atlas:

1. Bucket: yes, use private bucket `documents`, but the browser must never receive a Storage key and must not list/upload directly. Use a member-auth download endpoint that returns a short-lived signed URL only after checking the document row. TTL should be tight, preferably 60 seconds and no more than 120 seconds for Phase D.
2. Server-side re-render is required. Do not accept client-supplied PDF bytes, client-supplied storage paths, or arbitrary binary upload in this path. The endpoint should accept markdown/source metadata, rerun governance, rerender, then store the server-produced PDF.
3. Extend `doc_kind` additively for the five factory types. Also update any server/client catalogs and tests together. The existing `documents_origin_chk` currently allows only `ingested|draft`; the migration must replace it to include `rendered`.
4. Use `document_versions`, not versioned rows, but make versioning explicit and concurrency-safe. Either keep the first Phase D save path insert-only, or add `document_id` plus `expected_version_no`/`expected_updated_at` and lock the document row before snapshotting prior state. Do not infer version targets by title.
5. Metadata-only audit is sufficient if it records save and download actions without markdown body, PDF bytes, signed URL, or secrets. Actor must be the verified JWT uid, revalidated in the RPC.
6. Storage/RLS specifics: no public bucket, no broad `anon`/`authenticated` policies on `storage.objects`, no direct client writes. `document_versions` must have RLS enabled, no client select policy, and explicit `revoke all from anon, authenticated`. All write RPCs must be `security definer set search_path = ''`, fully qualified, and executable only by `service_role`.
7. Fold the shared Storage bucket/download infrastructure from `0021` into Phase D. Keep `0021` open for the later MCP arbitrary-file upload surface; Phase D is only factory-rendered PDFs from governed markdown.

Required implementation gates before apply/live approval:

- Storage/DB atomicity plan. Supabase Storage upload and Postgres RPC commit are not one transaction. Implement either DB reserve -> upload -> finalize, or upload -> RPC with delete-on-failure cleanup. Tests must prove failed RPC/governance/version conflict leaves no orphan rendered object.
- Immutable/versioned object paths. Generate paths server-side, e.g. `rendered/{document_id}/v{version_no}.pdf`; avoid overwrite/upsert for rendered versions unless the prior object was already captured in `document_versions`.
- Version history must snapshot enough prior state to restore or audit: previous `storage_path`, markdown/extracted text, title, doc_type, audience/policy mode if stored, deal_id, version_no, edited_by, change_reason, and timestamp.
- If the UI calls this “Save to brain,” the saved rendered document should be searchable through the existing document retrieval path: populate `extracted_text` and `document_chunks` with the same embedding discipline as C4.2, or explicitly label Phase D as metadata/download-only and defer RAG ingestion.
- Validate optional `deal_id` inside the RPC as well as the endpoint; bad/missing deal references must fail cleanly before any lasting DB state.
- Download endpoint must verify active membership and document existence, require `storage_path` and `origin='rendered'`, return only a short-lived signed URL, and write metadata-only audit.
- Smoke must cover: 401/403, strict args 400, governance 422 with zero residue, valid save -> row + private PDF + audit, direct member write denied for `documents`/`document_versions`/Storage, non-member download denied, signed URL yields `%PDF`, version conflict rejected, and cleanup/no orphan objects on injected failure.

With those controls, Atlas may proceed to implement Phase D as an unapplied migration + endpoints + tests. Aegis still needs implementation review before any migration apply or live persistence sign-off.

### Aegis - 2026-06-29 (Phase D implementation QC #1)

QC status: BLOCKED FOR APPLY. Do not apply migration `0022_document_factory_persist.sql` yet, and do not treat `/api/save-rendered-document` or `/api/document-download` as live-approved.

Independent checks run:

- `node functions/_lib/render-core.test.mjs` - 53/0
- `npm run build` - pass
- `git diff --check` - pass
- `node --env-file=.env.local scripts/smoke-render-document.mjs` - 19/0 against production; the existing live render endpoint still passes after the shared render helper refactor
- `npm audit --omit=dev --json` - 0 production vulnerabilities
- Static review of `supabase/migrations/0022_document_factory_persist.sql`, `functions/_lib/render-pdf.ts`, `functions/api/render-document.ts`, `functions/api/save-rendered-document.ts`, `functions/api/document-download.ts`, `src/pages/Create.tsx`, `src/pages/Documents.tsx`, and `scripts/smoke-save-rendered.mjs`

Positive findings:

- The migration is unapplied and correctly keeps this behind an apply gate.
- The bucket is private, PDF-only, and does not add broad `storage.objects` client policies.
- `document_versions` has RLS enabled and explicit `revoke all from anon, authenticated`.
- `save_rendered_document` is service-role-only, `security definer set search_path = ''`, validates active actor, validates `deal_id`, asserts immutable `rendered/{id}/v1.pdf`, writes v1 snapshot, and audits metadata only.
- The save endpoint server-side rerenders via the same governed render helper before upload; it does not accept client PDF bytes or storage paths.
- Download endpoint uses active-member auth and a 60-second signed URL.
- Insert-only first path is acceptable for this slice; it avoids version overwrite/concurrency complexity.
- Jesse's download-only decision is acceptable for Phase D if the UI/notes remain clear that this slice lists/downloads rendered PDFs and does not make them semantic-search/RAG indexed yet.

Blocking finding:

+ P1 - The smoke does not prove the critical post-upload RPC-failure cleanup path. `save-rendered-document.ts` uploads the PDF before calling `save_rendered_document`, then tries to delete the object only if the RPC fails. That is the exact Storage/DB non-atomic boundary Aegis required proof for. Current smoke covers governance 422 zero DB residue before upload, and a valid save/download, but it never triggers a failure after upload and before/inside the RPC. The current negative `deal_id` test uses a non-UUID and returns 400 before render/upload, so it does not exercise cleanup.

References:

- `functions/api/save-rendered-document.ts` lines 66-93: upload happens first, RPC happens second, cleanup is attempted on RPC error.
- `scripts/smoke-save-rendered.mjs` lines 75-82: the only residue test is pre-upload governance failure.
- `scripts/smoke-save-rendered.mjs` lines 84-119: valid save/download and direct-write denial are covered, but no post-upload RPC-failure cleanup assertion exists.
- `supabase/migrations/0022_document_factory_persist.sql` lines 103-107: a valid UUID but nonexistent `deal_id` is an available RPC-failure path after the endpoint has rendered/uploaded.

Required fix before apply approval:

1. Extend `scripts/smoke-save-rendered.mjs` with a valid-UUID nonexistent `deal_id` case, e.g. `00000000-0000-0000-0000-000000000000`, that reaches the RPC and fails after upload.
2. Prove both DB and Storage residue stay unchanged. Use service-role checks before/after: document count unchanged and no new object/folder under the `rendered/` prefix. If Supabase Storage listing is folder-shaped, count/list the UUID prefixes under `rendered` before and after.
3. Tighten cleanup observability in `save-rendered-document.ts`: after the DELETE cleanup request, check the response status. If cleanup fails, return a distinct error/detail so the smoke cannot silently pass while an orphan remains.
4. Rerun: render-core 53/0, `npm run build`, `git diff --check`, and the post-apply `smoke-save-rendered` after migration apply.

Not blocking in this slice:

- No RAG chunks for rendered PDFs. This is accepted because Jesse chose download-only. Do not market Phase D as semantic-search/RAG ingestion until `document_chunks` are populated.
- Download audit is best-effort. Acceptable for first live slice, but a future stricter audit gate can require audit failure to block signed URL issuance.

Aegis decision: implementation is close, but migration `0022` is not approved to apply until the post-upload RPC-failure cleanup path is tested and observable.

# 0023 — Document Factory: team-authored docs → branded 4ward layout → PDF

**Status:** OPEN — owner Atlas. Spec for review; **Phase A first deliverable DONE** (canonical brand
template module, verified). No migration/endpoint live yet.

**Phase A progress (2026-06-28):** canonical visual template lifted into the repo as the single source of
truth — `functions/_lib/brand-template.ts` (BRAND_CSS verbatim from `_build_pdfs.py`, `wrapBrandedHtml`,
`resolveLogo`, `DOC_TYPE_CATALOG` of 9 types) + `functions/_lib/brand-logo.ts` (logo base64 data URI,
md5 aaf5b23…). Verified: `tsc --noEmit` clean + 12/12 structural assertions (wrapper shape, title-escape,
logo swap, catalog) via an esbuild-bundle test; app `npm run build` unaffected (files are CF Functions,
outside `src`). No DB, no new deps. Functions have no standing unit-test harness in this repo (validated by
CF build + live smoke), so full render verification comes with Phase B's endpoint smoke.

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

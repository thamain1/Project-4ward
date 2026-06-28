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

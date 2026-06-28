// Mnemosyne — Document Factory (thread 0023), Phase A: the CANONICAL 4ward visual template.
//
// Single source of truth for how a 4ward document LOOKS. Previously the CSS print shell + logo + HTML
// wrapper were copy-pasted across three local Python scripts (Project-GIAV/contracts/_build_pdfs.py,
// 4ward/_build_capabilities_pdf.py, 4ward/_build_briefing_pdf.py), tied to a local Edge-headless render.
// This module lifts that layout into ONE server-usable place so every rendered document — contract or
// marketing — shares the exact same brand layout, and a layout change happens in exactly one spot.
//
// SEPARATION OF CONCERNS:
//   - CONTENT (what a doc says): contract-templates.ts (skeletons/slots/governance) + future doc-type skeletons.
//   - VISUAL (how it looks):     THIS module — CSS + HTML shell + logo. Layout only; no content, no governance.
//   - RENDER (md → HTML → PDF):  Phase B (CF Pages Function: markdown lib + Cloudflare Browser Rendering).
//
// The CSS is lifted verbatim from the proven _build_pdfs.py so output is pixel-identical to the GIAV
// contracts already produced. Logo is inlined (brand-logo.ts) so the HTML is self-contained (server render
// has no filesystem/remote access).

import { LOGO_DATA_URI } from './brand-logo'

// The canonical local reference writers use in markdown (and contract-templates.ts LOGO_BLOCK). The render
// path swaps it for the inlined data URI so the HTML needs no external fetch.
export const LOGO_LOCAL_REF = './4ward-motion-logo.png'

// ── Canonical print CSS (verbatim from Project-GIAV/contracts/_build_pdfs.py) ─────────────────────────────
export const BRAND_CSS = `
  @page { size: Letter; margin: 0.85in 0.75in; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Calibri", "Segoe UI", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #1a1a1a;
  }
  .logo { text-align: center; margin: 0 0 18pt; }
  .logo img { width: 200px; height: auto; }
  h1 {
    text-align: center;
    font-size: 22pt;
    margin: 6pt 0 14pt;
    letter-spacing: 0.3pt;
  }
  h2 {
    font-size: 13pt;
    margin: 18pt 0 6pt;
    border-bottom: 1px solid #d0d0d0;
    padding-bottom: 3pt;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt;
    margin: 12pt 0 4pt;
    page-break-after: avoid;
  }
  p, li, td, th { font-size: 11pt; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0 6pt 22pt; padding: 0; }
  li { margin: 3pt 0; }
  blockquote {
    margin: 8pt 0 8pt 0;
    padding: 6pt 12pt;
    border-left: 3px solid #c0c0c0;
    background: #fafafa;
    color: #404040;
    font-size: 10.5pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 12pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #c8c8c8;
    padding: 5pt 7pt;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f3f3f3; font-weight: 600; }
  code {
    font-family: "Consolas", "Courier New", monospace;
    font-size: 10pt;
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 3px;
  }
  hr { border: none; border-top: 1px solid #c0c0c0; margin: 14pt 0; }
  strong { font-weight: 600; }
  .small { font-size: 9.5pt; color: #555; }
  .signature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 36pt;
    margin: 18pt 0 8pt;
    page-break-inside: avoid;
  }
  .signature-block p {
    margin: 7pt 0;
    white-space: nowrap;
  }
  .signature-party {
    margin-bottom: 12pt !important;
  }
  .signature-label {
    display: inline-block;
    width: 42pt;
    font-weight: 600;
  }
  .signature-line,
  .date-line {
    display: inline-block;
    border-bottom: 1px solid #1a1a1a;
    height: 12pt;
    vertical-align: baseline;
  }
  .signature-line { width: 165pt; }
  .date-line { width: 95pt; }
`

// ── Doc-type catalog — every document the factory will produce ────────────────────────────────────────────
// category: 'contract' = client-facing binding/quasi-binding (strict governance, no vendor names);
//           'marketing' = collateral (capabilities, briefings, white papers, use cases).
// hasGenerator: whether a {{fill}}/{{draft}} skeleton exists today (mou/sow do, via contract-templates.ts).
//   The render layout applies to ALL types; generation skeletons for the rest land in Phase C.
export type DocCategory = 'contract' | 'marketing'
export interface DocTypeSpec {
  id: string
  label: string
  category: DocCategory
  renderTitle: string   // default <title>/H-context for the rendered document
  hasGenerator: boolean
}

export const DOC_TYPE_CATALOG: DocTypeSpec[] = [
  { id: 'mou',                label: 'Memorandum of Understanding', category: 'contract',  renderTitle: 'Memorandum of Understanding — 4ward Motion Solutions, Inc.', hasGenerator: true },
  { id: 'sow',                label: 'Statement of Work',           category: 'contract',  renderTitle: 'Statement of Work — 4ward Motion Solutions, Inc.',           hasGenerator: true },
  { id: 'proposal',           label: 'Proposal',                    category: 'contract',  renderTitle: 'Proposal — 4ward Motion Solutions, Inc.',                    hasGenerator: false },
  { id: 'invoice',            label: 'Invoice',                     category: 'contract',  renderTitle: 'Invoice — 4ward Motion Solutions, Inc.',                     hasGenerator: false },
  { id: 'change-order',       label: 'Change Order',                category: 'contract',  renderTitle: 'Change Order — 4ward Motion Solutions, Inc.',                hasGenerator: false },
  { id: 'white-paper',        label: 'White Paper',                 category: 'marketing', renderTitle: 'White Paper — 4ward Motion Solutions',                       hasGenerator: false },
  { id: 'use-case',           label: 'Use Case',                    category: 'marketing', renderTitle: 'Use Case — 4ward Motion Solutions',                          hasGenerator: false },
  { id: 'capabilities-brief', label: 'Capabilities Brief',          category: 'marketing', renderTitle: 'Capabilities Overview — 4ward Motion Solutions',             hasGenerator: false },
  { id: 'exec-briefing',      label: 'Executive Briefing',          category: 'marketing', renderTitle: 'Executive Briefing — 4ward Motion Solutions',                hasGenerator: false },
]

export function docTypeById(id: string): DocTypeSpec | undefined {
  return DOC_TYPE_CATALOG.find((d) => d.id === id)
}

// ── HTML shell (verbatim structure from _build_pdfs.py HTML_SHELL) ────────────────────────────────────────
// Escapes the title (it lands in <title> and is caller-influenced). bodyHtml is already-converted markup
// from the render layer (Phase B) and is the render layer's responsibility to sanitize.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function wrapBrandedHtml(opts: { title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<style>${BRAND_CSS}</style>
</head>
<body>
${opts.bodyHtml}
</body>
</html>
`
}

// Swap the local logo reference for the inlined data URI (mirrors _build_pdfs.py md_to_html). Run on the
// markdown BEFORE markdown→HTML conversion, so both hand-written docs and generate-contract output (which
// emit the LOGO_LOCAL_REF) become self-contained.
export function resolveLogo(markdown: string): string {
  return markdown.split(LOGO_LOCAL_REF).join(LOGO_DATA_URI)
}

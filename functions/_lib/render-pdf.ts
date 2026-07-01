// Mnemosyne — Document Factory (thread 0023): shared governed render-to-PDF helper.
// Single source of truth for "markdown → branded 4ward PDF bytes", reused by /api/render-document (returns
// the PDF) and /api/save-rendered-document (uploads it). Keeps the governance gate + Browser Rendering
// lockdown identical across both, so a persisted PDF is governed exactly like a downloaded one.

import { renderDocumentHtml } from './render-core'
import { docTypeById } from './brand-template'
import { scanByPolicy, policyFor, type ScanPolicy } from './contract-scan'

export type RenderResult =
  | { ok: true; pdf: ArrayBuffer; policy: ScanPolicy; title: string }
  | { ok: false; status: 422 | 502 | 503; body: any }

export type ScanOk = { ok: true; policy: ScanPolicy }
export type ScanErr = { ok: false; status: 422 | 502; body: any }

// Governance gate ONLY — cheap (regex over the markdown), no network call. Callers that need to
// rate-limit should run this FIRST (it's "cheap validation"), then check the caller's rate budget,
// then call renderScannedToPdf — so a policy-rejected or malformed request never spends a token
// (thread 0024 QC P2-ORDER: negatives must not drain a member's rate-limit bucket).
export function scanForRender(
  opts: { docTypeId: string; markdown: string; audience: 'client' | 'internal' },
): ScanOk | ScanErr {
  const spec = docTypeById(opts.docTypeId)
  if (!spec) return { ok: false, status: 502, body: { error: 'unknown doc type' } }
  const policy = policyFor(spec.category, opts.audience)
  const scan = scanByPolicy(opts.markdown, policy)
  if (!scan.clean) return { ok: false, status: 422, body: { error: 'prohibited content', policy, hits: scan.hits } }
  return { ok: true, policy }
}

// The expensive half: safe HTML + the actual Cloudflare Browser Rendering call. Callers must have
// already run scanForRender and passed its policy through.
export async function renderScannedToPdf(
  env: any,
  opts: { title: string; markdown: string; policy: ScanPolicy },
): Promise<RenderResult> {
  // safe HTML (markdown-it html:false + trusted tokens)
  const html = renderDocumentHtml({ title: opts.title, markdown: opts.markdown })

  const ACCOUNT = env?.CF_ACCOUNT_ID
  const TOKEN = env?.CF_BROWSER_RENDERING_TOKEN
  if (!ACCOUNT || !TOKEN) return { ok: false, status: 503, body: { error: 'render backend unavailable (CF Browser Rendering not configured)' } }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45000)
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-rendering/pdf`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      // allow ONLY inline data: requests (the logo); every external request is blocked → no remote load.
      body: JSON.stringify({ html, allowRequestPattern: ['^data:'] }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      return { ok: false, status: 502, body: { error: 'render failed', status: res.status, detail } }
    }
    return { ok: true, pdf: await res.arrayBuffer(), policy: opts.policy, title: opts.title }
  } catch (e: any) {
    return { ok: false, status: 502, body: { error: 'render failed', detail: String(e?.message ?? e).slice(0, 200) } }
  } finally {
    clearTimeout(timer)
  }
}

// Convenience wrapper composing scanForRender + renderScannedToPdf for callers that don't need to
// interleave a rate-limit check between the scan and the render (e.g. /api/save-rendered-document).
export async function renderToPdf(
  env: any,
  opts: { docTypeId: string; title: string; markdown: string; audience: 'client' | 'internal' },
): Promise<RenderResult> {
  const scan = scanForRender(opts)
  if (!scan.ok) return scan
  return renderScannedToPdf(env, { title: opts.title, markdown: opts.markdown, policy: scan.policy })
}

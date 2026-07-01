// Mnemosyne — Document Factory (thread 0023), Phase B: server-side render endpoint.
//
// POST { doc_type, title?, markdown, audience? } -> application/pdf (branded 4ward layout).
// Pipeline: requireMember (JWT -> active member, fail closed) -> strict args -> governance gate
// (scanByPolicy, by catalog category + audience; refuse 422 if not clean) -> renderDocumentHtml
// (markdown-it html:false + trusted tokens) -> Cloudflare Browser Rendering REST API -> PDF.
//
// WHY THE REST API (not the puppeteer binding): Cloudflare Pages Functions CANNOT bind Browser Rendering —
// the `browser` binding is Workers-only (Pages supports only a subset of bindings). These endpoints are Pages
// Functions, so we call the Browser Rendering REST /pdf endpoint with an API token instead. Same product, no
// binding required, and the lockdown is cleaner.
//
// STATELESS: no persistence, no audit row (Aegis gate 6 — audit enters in Phase D with persistence).
// Actor is the verified JWT member; never caller-supplied.
//
// BROWSER LOCKDOWN (Aegis gate 3): `allowRequestPattern: ["^data:"]` — the ONLY requests permitted during
// render are inline data: URIs (the base64 logo). Every external request (http/https/file/font/etc.) is
// structurally blocked. The HTML itself references nothing external (logo inlined, system fonts, no scripts,
// markdown rendered with html:false), so there is no external surface to begin with; the allow-list is the
// belt-and-suspenders proof.
//
// INFRA PREREQ (server-side env on the CF Pages project, NOT VITE_):
//   - CF_ACCOUNT_ID            — Cloudflare account id.
//   - CF_BROWSER_RENDERING_TOKEN — API token with the "Browser Rendering: Edit" permission.
// Until both are set the endpoint returns 503 cleanly (deploy-safe before they exist).

import { requireMember, parseStrict, json } from '../_lib/member-auth'
import { docTypeById } from '../_lib/brand-template'
import { scanForRender, renderScannedToPdf } from '../_lib/render-pdf'
import { checkRateLimit } from '../_lib/rate-limit'

const MAX_TITLE_LEN = 300
const MAX_MARKDOWN_LEN = 200_000   // generous outer bound for a long document
const RATE_LIMIT = 10       // renders per actor — each call spends a Browser Rendering token
const RATE_WINDOW_S = 60    // per this many seconds

export const onRequestPost = async (context: any): Promise<Response> => {
  // ---- auth (fail closed) ----
  const auth = await requireMember(context)
  if (!auth.ok) return auth.res

  // ---- strict args ----
  const parsed = await parseStrict(context, ['doc_type', 'title', 'markdown', 'audience'])
  if (!parsed.ok) return parsed.res
  const body = parsed.body

  const spec = docTypeById(typeof body.doc_type === 'string' ? body.doc_type : '')
  if (!spec) return json({ error: '"doc_type" must be a known document type' }, 400)
  if (typeof body.markdown !== 'string' || !body.markdown.trim()) return json({ error: '"markdown" must be a non-empty string' }, 400)
  if (body.markdown.length > MAX_MARKDOWN_LEN) return json({ error: `"markdown" exceeds ${MAX_MARKDOWN_LEN} chars` }, 400)
  let title = spec.renderTitle
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: '"title" must be a non-empty string' }, 400)
    if (body.title.length > MAX_TITLE_LEN) return json({ error: `"title" exceeds ${MAX_TITLE_LEN} chars` }, 400)
    title = body.title.trim()
  }
  let audience: 'client' | 'internal' = 'client'
  if (body.audience !== undefined) {
    if (body.audience !== 'client' && body.audience !== 'internal') return json({ error: '"audience" must be "client" or "internal"' }, 400)
    audience = body.audience
  }

  // ---- governance gate (cheap, no network) — a policy-rejected request must not spend a rate-limit
  // token (thread 0024 QC P2-ORDER) ----
  const scan = scanForRender({ docTypeId: spec.id, markdown: body.markdown, audience })
  if (!scan.ok) return json(scan.body, scan.status)

  // ---- rate limit — immediately before the expensive Browser Rendering call, after every cheap check ----
  const rate = await checkRateLimit(auth.admin, auth.uid, 'render_document', RATE_LIMIT, RATE_WINDOW_S)
  if (!rate.ok) return rate.res

  // ---- expensive: Cloudflare Browser Rendering lockdown ----
  const r = await renderScannedToPdf(context.env || {}, { title, markdown: body.markdown, policy: scan.policy })
  if (!r.ok) return json(r.body, r.status)
  return new Response(r.pdf, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${spec.id}.pdf"`,
    },
  })
}
// (Only onRequestPost is exported, so CF Pages auto-returns 405 for any non-POST method.)

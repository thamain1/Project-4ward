// Mnemosyne — keyless test for the canonical 4ward brand template (thread 0023, Phase A).
// Functions are TS and outside the Vite build, so this bundles brand-template.ts in-process with the
// esbuild that ships with Vite (no extra dep), then imports the bundle and asserts. Reproducible:
//   node functions/_lib/brand-template.test.mjs
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./brand-template.ts', import.meta.url))
const res = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, logLevel: 'error' })
const code = res.outputFiles[0].text
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { BRAND_CSS, DOC_TYPE_CATALOG, docTypeById, wrapBrandedHtml, resolveLogo, LOGO_LOCAL_REF } = mod

let pass = 0, fail = 0
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n) }

// ── wrapper shape + title escaping (title is caller-influenced → must be escaped) ──
const html = wrapBrandedHtml({ title: 'GIAV MOU & <b>"x"</b>', bodyHtml: '<h1>Body</h1>' })
ck('doctype present', html.startsWith('<!doctype html>'))
ck('title HTML-escaped', html.includes('<title>GIAV MOU &amp; &lt;b&gt;&quot;x&quot;&lt;/b&gt;</title>'))
ck('no raw title tags leak into <title>', !html.includes('<title>GIAV MOU & <b>'))
ck('CSS embedded in <style>', html.includes('<style>') && html.includes('@page { size: Letter'))
ck('bodyHtml injected verbatim', html.includes('<h1>Body</h1>'))
ck('signature-grid styling present', BRAND_CSS.includes('.signature-grid') && BRAND_CSS.includes('.signature-line'))

// ── logo replacement (self-contained render input) ──
const swapped = resolveLogo(`pre ${LOGO_LOCAL_REF} post`)
ck('resolveLogo → inlined png data URI', swapped.startsWith('pre data:image/png;base64,') && swapped.endsWith(' post'))
ck('resolveLogo data URI is non-trivial', swapped.length > 1000)
ck('resolveLogo leaves no local ref behind', !swapped.includes(LOGO_LOCAL_REF))
ck('resolveLogo no-op when ref absent', resolveLogo('plain text') === 'plain text')
ck('resolveLogo replaces every occurrence', (resolveLogo(`${LOGO_LOCAL_REF} ${LOGO_LOCAL_REF}`).match(/data:image\/png/g) || []).length === 2)

// ── catalog integrity ──
ck('catalog has 9 types', DOC_TYPE_CATALOG.length === 9)
ck('all ids unique', new Set(DOC_TYPE_CATALOG.map((d) => d.id)).size === DOC_TYPE_CATALOG.length)
ck('every category is contract|marketing', DOC_TYPE_CATALOG.every((d) => d.category === 'contract' || d.category === 'marketing'))
ck('every entry has label + renderTitle + boolean generator', DOC_TYPE_CATALOG.every((d) => !!d.label && !!d.renderTitle && typeof d.hasGenerator === 'boolean'))
ck('mou + sow are the generators today', DOC_TYPE_CATALOG.filter((d) => d.hasGenerator).map((d) => d.id).sort().join(',') === 'mou,sow')
ck('mou is contract w/ generator', docTypeById('mou')?.category === 'contract' && docTypeById('mou')?.hasGenerator === true)
ck('white-paper is marketing, no generator yet', docTypeById('white-paper')?.category === 'marketing' && docTypeById('white-paper')?.hasGenerator === false)
ck('unknown id → undefined', docTypeById('does-not-exist') === undefined)

console.log(`[brand-template-test] pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1

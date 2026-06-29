import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DOC_TYPE_CATALOG, docTypeById, starterFor } from '../lib/docTypes'

// Phase C2 — general Create-Document surface. Hand-author markdown for ANY of the 9 doc types and render the
// branded 4ward PDF via the live /api/render-document endpoint. MOU/SOW have an AI-assisted path on the
// Generate tab; this page is the universal hand-authoring + render surface (and the only path for the other
// types, which have no generator skeleton). Frontend-only; the endpoint enforces auth + governance + lockdown.
export default function Create() {
  const { session } = useAuth()
  const [docTypeId, setDocTypeId] = useState('white-paper')
  const [markdown, setMarkdown] = useState(() => starterFor('white-paper'))
  const [dirty, setDirty] = useState(false)
  const [audience, setAudience] = useState<'client' | 'internal'>('client')
  const [rendering, setRendering] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const spec = useMemo(() => docTypeById(docTypeId)!, [docTypeId])

  function pickType(id: string) {
    setDocTypeId(id)
    setErr(null)
    // reseed the editor with the type's starter unless the user has edited (avoid clobbering work)
    if (!dirty || markdown.trim() === '' || confirm('Replace the editor with this type’s starter template? Unsaved edits will be lost.')) {
      setMarkdown(starterFor(id)); setDirty(false)
    }
  }

  async function renderPdf() {
    if (!markdown.trim()) { setErr('Write some markdown first.'); return }
    setRendering(true); setErr(null)
    try {
      const res = await fetch('/api/render-document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ doc_type: docTypeId, markdown, audience }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 422 && Array.isArray(data?.hits)) throw new Error(`Blocked (${data.policy}): ${data.hits.map((h: any) => `${h.category} "${h.match}"`).join(', ')} — resolve before rendering.`)
        if (res.status === 503) throw new Error('Render backend not configured yet (Cloudflare Browser Rendering env).')
        throw new Error(data?.error || `render failed (${res.status})`)
      }
      const url = URL.createObjectURL(await res.blob())
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e: any) { setErr(e?.message ?? 'render failed') }
    finally { setRendering(false) }
  }

  // Persist the rendered PDF into the brain (Phase D) — server re-renders + stores; returns the doc id.
  async function saveToBrain() {
    if (!markdown.trim()) { setErr('Write some markdown first.'); return }
    setSaving(true); setErr(null); setSaveMsg(null)
    try {
      const res = await fetch('/api/save-rendered-document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ doc_type: docTypeId, markdown, audience }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(data?.hits)) throw new Error(`Blocked (${data.policy}): ${data.hits.map((h: any) => `${h.category} "${h.match}"`).join(', ')}`)
        throw new Error(data?.error || `save failed (${res.status})`)
      }
      setSaveMsg('Saved to the brain — find it under Documents (download any time).')
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${docTypeId}.md`; a.click(); URL.revokeObjectURL(url)
  }

  const contracts = DOC_TYPE_CATALOG.filter((d) => d.category === 'contract')
  const marketing = DOC_TYPE_CATALOG.filter((d) => d.category === 'marketing')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Create Document</h2>
        <p className="text-xs text-slate-500">
          Author any document in markdown and render the branded 4ward PDF — no local tooling.
          {' '}MOU / SOW have an AI-assisted form on the <span className="text-slate-400">Generate</span> tab.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={docTypeId} onChange={(e) => pickType(e.target.value)}
          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <optgroup label="Contract / client-facing">
            {contracts.map((d) => <option key={d.id} value={d.id}>{d.label}{d.hasGenerator ? ' (AI form on Generate)' : ''}</option>)}
          </optgroup>
          <optgroup label="Marketing / collateral">
            {marketing.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </optgroup>
        </select>

        {spec.category === 'marketing' && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Audience:
            <select value={audience} onChange={(e) => setAudience(e.target.value as 'client' | 'internal')}
              className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="client">Client-facing (no vendor names)</option>
              <option value="internal">Internal (vendor names OK)</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex gap-2">
          <button onClick={download} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100">Download .md</button>
          <button onClick={renderPdf} disabled={rendering}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-1.5 text-sm font-medium transition">
            {rendering ? 'Rendering…' : 'Render PDF'}
          </button>
          <button onClick={saveToBrain} disabled={saving}
            title="Render + store this document in the brain (downloadable under Documents)"
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 text-sm font-medium transition">
            {saving ? 'Saving…' : 'Save to brain'}
          </button>
        </div>
      </div>
      {saveMsg && <p className="text-sm text-emerald-400">{saveMsg}</p>}

      <textarea value={markdown} onChange={(e) => { setMarkdown(e.target.value); setDirty(true) }} spellCheck={false}
        className="w-full h-[60vh] resize-y rounded-lg bg-slate-900 border border-slate-700 px-3 py-3 text-sm font-mono leading-relaxed text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />

      {err && <p className="text-sm text-red-400">{err}</p>}

      <p className="text-[10px] text-slate-600">
        Branded blocks use trusted tokens: <code>{'{{block:logo}}'}</code> (centered 4ward logo) and{' '}
        <code>{'{{block:signature | entity=… | name=… | title=…}}'}</code> (4ward + client signature grid).
        Raw HTML is not rendered. Governance: secrets and unresolved <code>{'{{markers}}'}</code> are always
        blocked; vendor brand names are blocked on contracts and client-facing marketing.
      </p>
    </div>
  )
}

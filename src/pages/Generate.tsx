import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { SLOTS, DOC_TYPES, type DocType } from '../lib/contractSlots'

type Result = {
  doc_type: string
  title: string
  markdown: string
  sources: { id: string; title: string; doc_type: string; similarity: number }[]
  warnings: string[]
  scan_clean?: boolean
}

export default function Generate() {
  const { session } = useAuth()
  const [docType, setDocType] = useState<DocType>('mou')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [ground, setGround] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderErr, setRenderErr] = useState<string | null>(null)

  const slots = SLOTS[docType]
  const fillSlots = useMemo(() => slots.filter((s) => s.kind === 'fill'), [slots])
  const draftSlots = useMemo(() => slots.filter((s) => s.kind === 'draft'), [slots])

  function set(key: string, v: string) { setFields((f) => ({ ...f, [key]: v })) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true); setErr(null); setResult(null); setCopied(false)
    // only send non-empty fields that belong to this doc type
    const payloadFields: Record<string, string> = {}
    for (const s of slots) { const v = (fields[s.key] ?? '').trim(); if (v) payloadFields[s.key] = v }
    try {
      const res = await fetch('/api/generate-contract', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ doc_type: docType, fields: payloadFields, ground }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `generation failed (${res.status})`)
      setResult(data as Result); setSaveMsg(null); setSaveErr(null)
    } catch (e: any) { setErr(e?.message ?? 'generation failed') }
    finally { setLoading(false) }
  }

  async function save() {
    if (!result) return
    setSaving(true); setSaveMsg(null); setSaveErr(null)
    try {
      const res = await fetch('/api/save-document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ doc_type: result.doc_type, title: result.title, markdown: result.markdown }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(data?.hits)) throw new Error(`Blocked: ${data.hits.map((h: any) => `${h.category} "${h.match}"`).join(', ')}`)
        throw new Error(data?.error || `save failed (${res.status})`)
      }
      setSaveMsg(`Saved to the brain as a draft (${data.chunks} chunk${data.chunks === 1 ? '' : 's'}) — find it under Documents.`)
    } catch (e: any) { setSaveErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  // Render the branded 4ward PDF in-app (Phase C1) — POST the markdown to the live render endpoint and open
  // the returned PDF. Replaces the old "run _build_pdfs.py locally" step.
  async function renderPdf() {
    if (!result) return
    setRendering(true); setRenderErr(null)
    try {
      const res = await fetch('/api/render-document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ doc_type: result.doc_type, title: result.title, markdown: result.markdown }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 422 && Array.isArray(data?.hits)) throw new Error(`Blocked: ${data.hits.map((h: any) => `${h.category} "${h.match}"`).join(', ')} — resolve before rendering.`)
        if (res.status === 503) throw new Error('Render backend not configured yet (Cloudflare Browser Rendering env).')
        throw new Error(data?.error || `render failed (${res.status})`)
      }
      const url = URL.createObjectURL(await res.blob())
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e: any) { setRenderErr(e?.message ?? 'render failed') }
    finally { setRendering(false) }
  }

  function download() {
    if (!result) return
    const slug = (fields.project_name || result.doc_type).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    const blob = new Blob([result.markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${result.doc_type.toUpperCase()}_${slug || 'draft'}.md`
    a.click(); URL.revokeObjectURL(url)
  }

  async function copy() {
    if (!result) return
    await navigator.clipboard.writeText(result.markdown)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  function Field({ s }: { s: typeof slots[number] }) {
    const v = fields[s.key] ?? ''
    const isDraft = s.kind === 'draft'
    return (
      <label className="block space-y-1">
        <span className="text-xs text-slate-400">
          {s.label}{s.required && <span className="text-red-400"> *</span>}
          {isDraft && <span className="ml-1 rounded bg-violet-500/15 text-violet-300 px-1 py-0.5 text-[10px]">AI-drafted</span>}
        </span>
        {isDraft || s.multiline ? (
          <textarea value={v} onChange={(e) => set(s.key, e.target.value)} rows={isDraft ? 3 : 2}
            placeholder={isDraft ? `Brief — ${s.help}` : s.help}
            className="w-full resize-y rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        ) : (
          <input value={v} onChange={(e) => set(s.key, e.target.value)} placeholder={s.help}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
      </label>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Generate</h2>
        <p className="text-xs text-slate-500">
          Governed MOU / SOW drafts · 4ward entity, Delaware law, and the legal boilerplate are fixed — only the
          marked sections are AI-drafted. <span className="text-slate-400">A draft for your review, not a final or signed document.</span>
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select value={docType} onChange={(e) => { setDocType(e.target.value as DocType); setResult(null) }}
            className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={ground} onChange={(e) => setGround(e.target.checked)} className="accent-blue-500" />
            Ground on a prior {docType.toUpperCase()} (style reference)
          </label>
          <button type="submit" disabled={loading} className="ml-auto rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-2 text-sm font-medium transition">
            {loading ? 'Drafting…' : 'Generate draft'}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-3">
            <h3 className="text-sm font-medium text-slate-300">Engagement details <span className="text-xs text-slate-600">(filled exactly)</span></h3>
            {fillSlots.map((s) => <Field key={s.key} s={s} />)}
          </div>
          <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-3 space-y-3">
            <h3 className="text-sm font-medium text-slate-300">Narrative briefs <span className="text-xs text-slate-600">(AI-drafted from your notes)</span></h3>
            {draftSlots.map((s) => <Field key={s.key} s={s} />)}
          </div>
        </div>
      </form>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {result && (
        <div className="space-y-3">
          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
              <p className="text-xs font-medium text-amber-300">Review needed</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-200/80">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{result.title}</h3>
            <div className="ml-auto flex gap-2">
              <button onClick={copy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100">{copied ? 'Copied' : 'Copy markdown'}</button>
              <button onClick={download} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100">Download .md</button>
              <button onClick={renderPdf} disabled={rendering || result.scan_clean === false}
                title={result.scan_clean === false ? 'Resolve the flagged content before rendering' : 'Render the branded 4ward PDF'}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium transition">
                {rendering ? 'Rendering…' : 'Render PDF'}
              </button>
              <button onClick={save} disabled={saving || result.scan_clean === false}
                title={result.scan_clean === false ? 'Resolve the flagged content before saving' : 'Save this draft into the brain (searchable under Documents)'}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium transition">
                {saving ? 'Saving…' : 'Save to brain'}
              </button>
            </div>
          </div>
          {saveMsg && <p className="text-sm text-emerald-400">{saveMsg}</p>}
          {saveErr && <p className="text-sm text-red-400">{saveErr}</p>}
          {renderErr && <p className="text-sm text-red-400">{renderErr}</p>}
          {result.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">style reference:</span>
              {result.sources.map((s) => <span key={s.id} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{s.title}</span>)}
            </div>
          )}
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300 font-mono leading-relaxed">{result.markdown}</pre>
          <p className="text-[10px] text-slate-600">
            <strong className="text-slate-500">Render PDF</strong> produces the branded 4ward PDF in your browser — no local tooling needed.
            Confirm every bracketed item, figure, and party detail before signature. This is a draft, not legal advice.
          </p>
        </div>
      )}
    </div>
  )
}

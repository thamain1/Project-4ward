import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

type Doc = {
  id: string
  title: string
  doc_type: string
  project_id: string | null
  created_at: string
  origin?: string | null
  deal_id?: string | null
  deals?: { title: string } | null
}
type Hit = Doc & { similarity: number; matched_via?: string }

const TYPE_COLORS: Record<string, string> = {
  mou: 'bg-blue-500/15 text-blue-300',
  sow: 'bg-emerald-500/15 text-emerald-300',
  proposal: 'bg-violet-500/15 text-violet-300',
  invoice: 'bg-amber-500/15 text-amber-300',
  other: 'bg-slate-700 text-slate-300',
}
const GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
// deal = the linked deals.title via documents.deal_id FK (0015_crm_writes_and_linkage.sql); falls back
// to the legacy "<Deal> — …" title-prefix heuristic for documents not yet linked to a deal (thread
// 0024 QC P1 — the CRM has zero deals seeded today, so every document is unlinked until one exists).
const dealOf = (d: Doc) => d.deals?.title?.trim() || (d.title.split(' — ')[0] || 'Other').trim()

export default function Documents() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const [sq, setSq] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [openTitle, setOpenTitle] = useState('')
  const [openOrigin, setOpenOrigin] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [textLoading, setTextLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadErr, setDownloadErr] = useState<string | null>(null)

  // Q&A (C2 — RAG over contracts)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ answer: string; sources: { id: string; title: string; doc_type: string; similarity: number }[] } | null>(null)
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)

  useEffect(() => {
    // Try selecting `origin` (added in migration 0013); fall back gracefully if it isn't applied yet.
    async function load() {
      let data: any[] | null
      let error: { message: string } | null
      const withOrigin = await supabase
        .from('documents').select('id, title, doc_type, project_id, created_at, origin, deal_id, deals(title)')
        .order('created_at', { ascending: false })
      if (withOrigin.error) {
        const res = await supabase
          .from('documents').select('id, title, doc_type, project_id, created_at, deal_id, deals(title)')
          .order('created_at', { ascending: false })
        data = res.data; error = res.error
      } else {
        data = withOrigin.data; error = null
      }
      if (error) setErr(error.message)
      else setRows((data ?? []) as Doc[])
      setLoading(false)
    }
    load()
  }, [])

  const browse = useMemo(() => {
    const s = filter.trim().toLowerCase()
    return rows.filter((r) => !s || r.title.toLowerCase().includes(s) || r.doc_type.includes(s))
  }, [rows, filter])

  // group browse by deal
  const groups = useMemo(() => {
    const m = new Map<string, Doc[]>()
    for (const d of browse) { const g = dealOf(d); if (!m.has(g)) m.set(g, []); m.get(g)!.push(d) }
    return [...m.entries()].map(([deal, items]) => ({ deal, items })).sort((a, b) => b.items.length - a.items.length || a.deal.localeCompare(b.deal))
  }, [browse])

  async function runSearch(e: FormEvent) {
    e.preventDefault()
    const q = sq.trim()
    if (!q) { setHits(null); setSearchErr(null); return }
    setSearching(true); setSearchErr(null)
    try {
      const res = await fetch('/api/search-docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ query: q, k: 12 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`)
      setHits((data.results ?? []) as Hit[])
    } catch (e: any) { setSearchErr(e?.message ?? 'search failed'); setHits(null) }
    finally { setSearching(false) }
  }
  function clearSearch() { setSq(''); setHits(null); setSearchErr(null) }

  async function ask(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setAsking(true); setAskErr(null); setAnswer(null)
    try {
      const res = await fetch('/api/ask-docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `ask failed (${res.status})`)
      setAnswer(data)
    } catch (e: any) { setAskErr(e?.message ?? 'ask failed') }
    finally { setAsking(false) }
  }

  async function openDoc(d: Doc | Hit) {
    setOpenId(d.id); setOpenTitle(d.title); setOpenOrigin((d as Doc).origin ?? null); setText(''); setTextLoading(true); setDownloadErr(null)
    const { data, error } = await supabase.from('documents').select('extracted_text').eq('id', d.id).maybeSingle()
    setText(error ? `Error: ${error.message}` : ((data?.extracted_text as string) ?? '(no text)'))
    setTextLoading(false)
  }

  // Phase D: fetch a short-lived signed URL for a rendered doc's PDF and open it.
  async function downloadPdf(id: string) {
    setDownloading(true); setDownloadErr(null)
    try {
      const res = await fetch('/api/document-download', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) throw new Error(data?.error || `download failed (${res.status})`)
      window.open(data.url, '_blank', 'noopener')
    } catch (e: any) { setDownloadErr(e?.message ?? 'download failed') }
    finally { setDownloading(false) }
  }

  const inSearch = hits !== null

  function DocCard({ d }: { d: Doc | Hit }) {
    return (
      <button onClick={() => openDoc(d)} className="text-left h-full flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700 transition p-3">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TYPE_COLORS[d.doc_type] ?? TYPE_COLORS.other}`}>{d.doc_type}</span>
          {d.origin === 'draft' && <span className="shrink-0 rounded bg-violet-500/15 text-violet-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">draft</span>}
          {d.origin === 'rendered' && <span className="shrink-0 rounded bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">PDF</span>}
          {'similarity' in d && <span className="ml-auto shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-blue-300">{((d as Hit).similarity * 100).toFixed(0)}%</span>}
        </div>
        <span className="text-sm font-medium line-clamp-2">{d.title}</span>
        <span className="mt-auto text-xs text-slate-500">{new Date(d.created_at).toLocaleDateString()}</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-xs text-slate-500">
            {loading ? 'Loading…' : inSearch ? `${hits!.length} semantic matches` : `${browse.length} contract${browse.length === 1 ? '' : 's'}`}
            {' · MOUs / SOWs / proposals / invoices'}
          </p>
        </div>

        {/* Q&A — ask a question across all contracts (RAG, cited) */}
        <form onSubmit={ask} className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input placeholder="Ask your contracts — e.g. “What are GIAV’s milestone amounts?”" value={question} onChange={(e) => setQuestion(e.target.value)}
              className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button type="submit" disabled={asking} className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium transition">{asking ? 'Thinking…' : 'Ask'}</button>
          </div>
          {askErr && <p className="text-sm text-red-400">{askErr}</p>}
          {answer && (
            <div className="space-y-2">
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
              {answer.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 self-center">sources:</span>
                  {answer.sources.map((s) => (
                    <button key={s.id} onClick={() => openDoc(s as any)} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[11px] text-blue-300 transition">
                      {s.title} ({(s.similarity * 100).toFixed(0)}%)
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-600">Generated from your contracts — verify against the source documents before relying on it.</p>
            </div>
          )}
        </form>

        <form onSubmit={runSearch} className="flex items-center gap-2">
          <input placeholder="Semantic search — e.g. “GIAV payment terms”, “M1 milestone amount”…" value={sq} onChange={(e) => setSq(e.target.value)}
            className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={searching} className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium transition">{searching ? 'Searching…' : 'Search'}</button>
          {inSearch && <button type="button" onClick={clearSearch} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-100">Clear</button>}
        </form>
        {searchErr && <p className="text-sm text-red-400">{searchErr}</p>}
        {!inSearch && (
          <div className="flex justify-end">
            <input placeholder="Quick filter…" value={filter} onChange={(e) => setFilter(e.target.value)}
              className="w-48 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {!loading && rows.length === 0 && !err && (
        <div className="rounded-lg border border-dashed border-slate-800 px-4 py-10 text-center">
          <p className="text-sm text-slate-400">No contracts ingested yet.</p>
          <p className="text-xs text-slate-600 mt-1">Run the contract ingestion to populate MOUs / SOWs / proposals / invoices.</p>
        </div>
      )}

      {inSearch ? (
        hits!.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No confident matches.</p>
          : <div className={GRID}>{hits!.map((d) => <DocCard key={d.id} d={d} />)}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.deal}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium">{g.deal}</h3>
                <span className="text-xs text-slate-500">{g.items.length}</span>
              </div>
              <div className={GRID}>{g.items.map((d) => <DocCard key={d.id} d={d} />)}</div>
            </div>
          ))}
        </div>
      )}

      {openId && (
        <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold">{openTitle}</h3>
              <div className="flex items-center gap-2">
                {openOrigin === 'rendered' && (
                  <button onClick={() => downloadPdf(openId)} disabled={downloading}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium transition">
                    {downloading ? 'Preparing…' : 'Download PDF'}
                  </button>
                )}
                <button onClick={() => setOpenId(null)} className="text-slate-500 hover:text-slate-200 text-sm">Close</button>
              </div>
            </div>
            {downloadErr && <p className="text-sm text-red-400 mb-2">{downloadErr}</p>}
            {textLoading ? <p className="text-sm text-slate-500">Loading…</p>
              : <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-mono leading-relaxed">{text}</pre>}
          </div>
        </div>
      )}
    </div>
  )
}

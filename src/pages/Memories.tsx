import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

type Entry = {
  name: string
  title: string | null
  kind: string
  source_path: string | null
  updated_at: string
}

type Hit = Entry & { similarity: number; matched_via?: string }

const KIND_COLORS: Record<string, string> = {
  project: 'bg-blue-500/15 text-blue-300',
  reference: 'bg-emerald-500/15 text-emerald-300',
  feedback: 'bg-amber-500/15 text-amber-300',
  user: 'bg-violet-500/15 text-violet-300',
}

export default function Memories() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // quick text filter (client-side, as-you-type) over the loaded browse list
  const [filter, setFilter] = useState('')

  // semantic search (explicit; server-side via /api/recall)
  const [sq, setSq] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)

  const [openName, setOpenName] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [bodyLoading, setBodyLoading] = useState(false)

  useEffect(() => {
    supabase
      .from('memory_entries')
      .select('name, title, kind, source_path, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        else setRows((data ?? []) as Entry[])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    const s = filter.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(s) || (r.title ?? '').toLowerCase().includes(s))
  }, [rows, filter])

  async function runSemanticSearch(e: FormEvent) {
    e.preventDefault()
    const q = sq.trim()
    if (!q) { setHits(null); setSearchErr(null); return }
    setSearching(true)
    setSearchErr(null)
    try {
      const res = await fetch('/api/recall', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ query: q, k: 12 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`)
      setHits((data.results ?? []) as Hit[])
    } catch (e: any) {
      setSearchErr(e?.message ?? 'search failed')
      setHits(null)
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setSq('')
    setHits(null)
    setSearchErr(null)
  }

  async function openEntry(name: string) {
    setOpenName(name)
    setBody('')
    setBodyLoading(true)
    const { data, error } = await supabase.from('memory_entries').select('body').eq('name', name).maybeSingle()
    setBody(error ? `Error: ${error.message}` : ((data?.body as string) ?? ''))
    setBodyLoading(false)
  }

  const inSearch = hits !== null
  const list: (Entry | Hit)[] = inSearch ? hits! : filtered

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Memories</h2>
            <p className="text-xs text-slate-500">
              {loading ? 'Loading…' : inSearch ? `${hits!.length} semantic matches` : `${filtered.length} of ${rows.length}`}
              {inSearch ? ' · ranked by relevance' : ' · quick text filter'}
            </p>
          </div>
          {!inSearch && (
            <input
              placeholder="Quick filter (name/title)…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-56 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        {/* semantic search bar */}
        <form onSubmit={runSemanticSearch} className="flex items-center gap-2">
          <input
            placeholder="Semantic search — ask by meaning, e.g. “OnTheHash payment flow”…"
            value={sq}
            onChange={(e) => setSq(e.target.value)}
            className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={searching} className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium transition">
            {searching ? 'Searching…' : 'Search'}
          </button>
          {inSearch && (
            <button type="button" onClick={clearSearch} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-100">
              Clear
            </button>
          )}
        </form>
        {searchErr && <p className="text-sm text-red-400">{searchErr}</p>}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 overflow-hidden">
        {list.map((r) => (
          <button
            key={r.name}
            onClick={() => openEntry(r.name)}
            className="w-full text-left px-4 py-3 hover:bg-slate-900/60 transition flex items-start gap-3"
          >
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_COLORS[r.kind] ?? 'bg-slate-700 text-slate-300'}`}>
              {r.kind}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{r.title || r.name}</span>
              <span className="block text-xs text-slate-500 truncate">
                {r.name} · {r.source_path} · {new Date(r.updated_at).toLocaleDateString()}
              </span>
            </span>
            {'similarity' in r && (
              <span className="mt-0.5 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-blue-300" title={(r as Hit).matched_via}>
                {((r as Hit).similarity * 100).toFixed(0)}%
              </span>
            )}
          </button>
        ))}
        {!loading && list.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500">{inSearch ? 'No confident matches.' : 'No matches.'}</p>
        )}
      </div>

      {openName && (
        <div className="fixed inset-0 z-20 flex" onClick={() => setOpenName(null)}>
          <div className="ml-auto h-full w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold">{openName}</h3>
              <button onClick={() => setOpenName(null)} className="text-slate-500 hover:text-slate-200 text-sm">Close</button>
            </div>
            {bodyLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-mono leading-relaxed">{body}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

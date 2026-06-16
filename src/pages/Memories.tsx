import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { groupEntries } from '../lib/memoryGroups'

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

type KindFilter = 'all' | 'project' | 'reference' | 'feedback' | 'user'
const KIND_TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'project', label: 'Projects' },
  { id: 'reference', label: 'Reference' },
  { id: 'feedback', label: 'Feedback' },
]

export default function Memories() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [kind, setKind] = useState<KindFilter>('all')
  const [filter, setFilter] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

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

  // browse set: kind filter + quick text filter
  const browse = useMemo(() => {
    const s = filter.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false
      if (s && !(r.name.toLowerCase().includes(s) || (r.title ?? '').toLowerCase().includes(s))) return false
      return true
    })
  }, [rows, kind, filter])

  const groups = useMemo(() => groupEntries(browse), [browse])

  async function runSemanticSearch(e: FormEvent) {
    e.preventDefault()
    const q = sq.trim()
    if (!q) { setHits(null); setSearchErr(null); return }
    setSearching(true); setSearchErr(null)
    try {
      const res = await fetch('/api/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ query: q, k: 12 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `search failed (${res.status})`)
      setHits((data.results ?? []) as Hit[])
    } catch (e: any) {
      setSearchErr(e?.message ?? 'search failed'); setHits(null)
    } finally { setSearching(false) }
  }
  function clearSearch() { setSq(''); setHits(null); setSearchErr(null) }

  async function openEntry(name: string) {
    setOpenName(name); setBody(''); setBodyLoading(true)
    const { data, error } = await supabase.from('memory_entries').select('body').eq('name', name).maybeSingle()
    setBody(error ? `Error: ${error.message}` : ((data?.body as string) ?? ''))
    setBodyLoading(false)
  }

  const inSearch = hits !== null

  function EntryRow({ r }: { r: Entry | Hit }) {
    return (
      <button onClick={() => openEntry(r.name)} className="w-full text-left px-4 py-2.5 hover:bg-slate-900/60 transition flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_COLORS[r.kind] ?? 'bg-slate-700 text-slate-300'}`}>{r.kind}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{r.title || r.name}</span>
          <span className="block text-xs text-slate-500 truncate">{r.name} · {new Date(r.updated_at).toLocaleDateString()}</span>
        </span>
        {'similarity' in r && (
          <span className="mt-0.5 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-blue-300" title={(r as Hit).matched_via}>
            {((r as Hit).similarity * 100).toFixed(0)}%
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Memories</h2>
          <p className="text-xs text-slate-500">
            {loading ? 'Loading…' : inSearch ? `${hits!.length} semantic matches · ranked by relevance` : `${browse.length} of ${rows.length} · grouped`}
          </p>
        </div>

        {/* semantic search */}
        <form onSubmit={runSemanticSearch} className="flex items-center gap-2">
          <input
            placeholder="Semantic search — ask by meaning, e.g. “OnTheHash payment flow”…"
            value={sq} onChange={(e) => setSq(e.target.value)}
            className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={searching} className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium transition">
            {searching ? 'Searching…' : 'Search'}
          </button>
          {inSearch && <button type="button" onClick={clearSearch} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-100">Clear</button>}
        </form>
        {searchErr && <p className="text-sm text-red-400">{searchErr}</p>}

        {/* kind tabs + quick filter (browse mode only) */}
        {!inSearch && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1">
              {KIND_TABS.map((t) => (
                <button key={t.id} onClick={() => setKind(t.id)}
                  className={`px-2.5 py-1 rounded-md text-xs transition ${kind === t.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <input placeholder="Quick filter…" value={filter} onChange={(e) => setFilter(e.target.value)}
              className="w-48 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}

        {kind === 'reference' && !inSearch && (
          <p className="text-xs text-emerald-400/80">Reusable patterns &amp; references — building blocks to reuse across projects.</p>
        )}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {/* SEARCH RESULTS — flat, ranked */}
      {inSearch && (
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 overflow-hidden">
          {hits!.map((r) => <EntryRow key={r.name} r={r} />)}
          {hits!.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No confident matches.</p>}
        </div>
      )}

      {/* BROWSE — grouped, collapsible drill-down */}
      {!inSearch && (
        <div className="space-y-2">
          {groups.map((g) => {
            const open = openGroups[g.key] ?? (groups.length <= 4)
            return (
              <div key={g.key} className="rounded-lg border border-slate-800 overflow-hidden">
                <button onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !open }))}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-900/50 hover:bg-slate-900 transition text-left">
                  <span className="text-slate-500 text-xs">{open ? '▾' : '▸'}</span>
                  <span className="text-sm font-medium">{g.label}</span>
                  <span className="ml-auto text-xs text-slate-500">{g.items.length}</span>
                </button>
                {open && <div className="divide-y divide-slate-800 border-t border-slate-800">{g.items.map((r) => <EntryRow key={r.name} r={r} />)}</div>}
              </div>
            )
          })}
          {!loading && groups.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No entries.</p>}
        </div>
      )}

      {/* DETAIL DRAWER */}
      {openName && (
        <div className="fixed inset-0 z-20 flex" onClick={() => setOpenName(null)}>
          <div className="ml-auto h-full w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold">{openName}</h3>
              <button onClick={() => setOpenName(null)} className="text-slate-500 hover:text-slate-200 text-sm">Close</button>
            </div>
            {bodyLoading ? <p className="text-sm text-slate-500">Loading…</p>
              : <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-mono leading-relaxed">{body}</pre>}
          </div>
        </div>
      )}
    </div>
  )
}

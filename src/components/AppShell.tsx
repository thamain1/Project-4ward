import { type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

export type Tab = 'memories' | 'documents' | 'activity' | 'team'

const TABS: { id: Tab; label: string }[] = [
  { id: 'memories', label: 'Memories' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
  { id: 'team', label: 'Team' },
]

export default function AppShell({
  tab,
  onTab,
  children,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  children: ReactNode
}) {
  const { member, user, signOut } = useAuth()
  const name = member?.full_name ?? user?.email ?? 'Signed in'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <img src="/mnemosyne-logo.png" alt="Mnemosyne" className="w-9 h-9 rounded-lg" />
          <span className="font-semibold tracking-tight">Mnemosyne</span>
          <nav className="ml-6 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`px-3 py-1.5 rounded-md text-sm transition ${
                  tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-400">
              {name}
              {member?.role === 'admin' && <span className="ml-1 text-xs text-blue-400">admin</span>}
            </span>
            <button onClick={signOut} className="text-slate-500 hover:text-slate-200">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}

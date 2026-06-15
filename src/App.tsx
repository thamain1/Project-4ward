export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <img
          src="/mnemosyne-logo.png"
          alt="Mnemosyne — by 4ward Motion Solutions, Inc."
          className="mx-auto w-40 h-40 rounded-2xl shadow-lg"
        />
        <h1 className="text-4xl font-bold tracking-tight">Mnemosyne</h1>
        <p className="text-slate-400">
          The shared second brain for 4ward Motion Solutions — development, sales &amp;
          maintenance factory. Phase 0 scaffold.
        </p>
        <p className="text-xs text-slate-600">
          Next: wire Supabase auth, the dashboard, and the mnemosyne MCP server.
        </p>
      </div>
    </div>
  )
}

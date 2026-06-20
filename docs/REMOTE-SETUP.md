# Mnemosyne MCP — Remote Machine Setup (Windows 11)

How to bring the **Mnemosyne MCP server** up on a second/remote Windows 11 machine so
Claude Code there can `recall`, `remember`, `log_update`, and `get_secret` against the
same shared brain.

---

## What you're actually setting up

Mnemosyne's MCP is a **local stdio server** — Claude Code spawns `node server.mjs` as a
child process. It is **not** a shared remote endpoint.

- The **data** (memories, CRM, documents) already lives in the cloud — Supabase project
  `qdugyduthemcrmtvgqek`. Every machine talks to that same project, so they share one brain.
- Only the **server process runs per-machine**. So "setting up the remote" = making that
  machine able to *run its own copy* of the server, pointed at the same Supabase + Gemini.

Copying the MCP JSON config alone does **not** work — the remote also needs the code, the
npm dependencies, and the secrets.

```
Claude Code (remote)  ──spawns──►  node server.mjs  ──┬──►  Supabase (recall_memory RPC, pgvector)
                                                      └──►  Gemini (embeddings only — no LLM/agent)
```

**Gemini is embeddings-only** (`gemini-embedding-001`): it vectorizes search queries
(`recall`) and stored content (`remember`). There is no chat/agent call in the server.
`log_update` and `get_secret` don't use Gemini at all.

---

## Prerequisites on the remote

| Tool | Check | Notes |
|------|-------|-------|
| Node.js | `node --version` | Any current LTS. Brings `npm` too. |
| Claude Code | `claude --version` | The MCP is registered via its CLI. |
| Git | `git --version` | To clone the repo (or copy the folder over). |

---

## Steps

### 1. Get the code

Clone anywhere — the folder location does **not** matter (the setup script auto-detects it):

```powershell
git clone https://github.com/thamain1/Project-Mnemosyne.git
cd Project-Mnemosyne\mcp
```

> Why location doesn't matter: inside `server.mjs`, `lib/` is imported with a **relative**
> path (`./lib/...`) and secrets come from `process.env`. Nothing is hardcoded to an absolute
> path. The only two location-sensitive values are the two paths in the MCP registration,
> and the setup script fills those from wherever you run it.
>
> The one rule: keep the `mcp/` folder's **internals together** — `server.mjs`, `lib/`,
> `node_modules`, and `.env.local` in their normal layout. Run `npm ci` *in* that folder so
> `node_modules` lands next to `server.mjs`.

### 2. Run the setup script

Place `setup-mnemosyne-mcp.ps1` into this `mcp\` folder, then from inside it:

```powershell
.\setup-mnemosyne-mcp.ps1
```

If PowerShell blocks it ("running scripts is disabled"), run it for this session only:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-mnemosyne-mcp.ps1
```

The script does, in order:

1. Auto-detects the `mcp\` folder from the current directory.
2. Verifies `node` / `npm` / `claude` are on PATH.
3. `npm ci` — installs deps in place.
4. Writes `.env.local` (the 4 secrets).
5. **Smoke 1** — keyless code-wiring test (`node test-recall.mjs`).
6. **Smoke 2** — live end-to-end: Gemini embed → Supabase `recall_memory` RPC.
   Aborts before registering if either smoke fails.
7. Registers the MCP at **user scope** with the remote's real absolute paths.

### 3. Restart Claude Code

MCP servers load at session start. Open a **new** Claude Code session, then confirm:

```powershell
claude mcp list
```

`mnemosyne` should show as connected, exposing `recall`, `remember`, `log_update`,
`get_secret`.

---

## The secrets (`.env.local`)

Four values, **not in git** — they ship inside the setup script and must be transferred
securely (the secured TeamViewer clipboard is fine):

| Key | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Embeddings for `recall` / `remember`. |
| `VITE_SUPABASE_URL` | The shared Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Full RLS-bypass god-key** for the project — treat as top secret. |
| `OPERATOR_MEMBER_ID` | Which team member this machine acts as (audit attribution). Change it if the remote should act as a different operator. |

**Security:**
- The service-role key grants full read/write to the entire Mnemosyne brain. Anyone with
  access to that file/machine can read and modify everything.
- Move the setup script over a private channel only (TeamViewer clipboard / `scp` / USB).
  Never email it, paste it into a web tool, or commit it.
- **Delete `setup-mnemosyne-mcp.ps1` from the remote after it runs** — it contains the key.
- `.env.local` stays on disk (the server reads it each launch) but is gitignored. Restrict
  the machine's user accounts accordingly.

---

## Manual registration (if you skip the script)

Run **from inside the `mcp\` folder** so `$pwd` resolves to the real path:

```powershell
npm ci
# create .env.local with the 4 keys, then:
claude mcp add mnemosyne -s user -- node "--env-file=$($pwd.Path)\.env.local" "$($pwd.Path)\server.mjs"
```

Resulting config (for reference):

```json
"mnemosyne": {
  "type": "stdio",
  "command": "node",
  "args": [
    "--env-file=<REMOTE_PATH>\\Project-Mnemosyne\\mcp\\.env.local",
    "<REMOTE_PATH>\\Project-Mnemosyne\\mcp\\server.mjs"
  ],
  "env": {}
}
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `server.mjs not found` on script start | You're not in the `mcp\` folder. `cd` into it and re-run. |
| `'node'/'npm'/'claude' not found` | Tool not installed or not on PATH. Install, reopen PowerShell. |
| Smoke 2 fails with auth/permission error | Bad/rotated `SUPABASE_SERVICE_ROLE_KEY`, or wrong project URL. |
| Smoke 2 fails with timeout/network | Firewall blocking outbound HTTPS to Supabase or Google; or bad `GEMINI_API_KEY`. |
| `mnemosyne` missing in `claude mcp list` | Registration didn't complete, or you didn't restart the session. Re-run step 2, start a fresh session. |
| `recall`/`remember` fail but `log_update` works | Gemini path broken (key/rate limit/network) — embeddings unavailable. |
| Tools appear but every call errors | Re-run the script; check `.env.local` exists next to `server.mjs` and `node_modules` is present. |

---

## Re-running / updating

- The setup script is **idempotent** — it removes any stale `mnemosyne` registration before
  re-adding, so you can re-run it safely.
- To update the server code later: `git pull` in the repo, `npm ci` in `mcp\`, restart the
  Claude Code session. No re-registration needed unless the folder moved.

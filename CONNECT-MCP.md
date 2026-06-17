# Connect a remote machine to the Mnemosyne MCP (recall + log_update)

Hand this to the remote Claude Code instance to attach the **`mnemosyne`** MCP server (custom — `recall` /
`remember` / `log_update` / `get_secret`).

> ⚠️ **READ FIRST — this is the INTERIM, single-operator path.** As built, the MCP runs **locally** (stdio)
> and holds the **`SUPABASE_SERVICE_ROLE_KEY`** (RLS-bypassing, full read/write to the whole brain) plus the
> bundled **`get_secret`** tool (reaches the secrets vault). Following these steps puts the master key + vault
> reach on this machine. Only do it on a **trusted 4ward machine you control**, never an external teammate's.
> The **safe multi-machine path** (no service-role key on the remote, scoped to recall + log_update) is
> `docs/MCP-PHASE2-PLAN.md` — use that before fanning out to *all* machines.

---

## 1. Get the server code

The MCP lives in the Mnemosyne repo. On the remote machine:

```bash
git clone https://github.com/thamain1/Project-Mnemosyne
cd Project-Mnemosyne/mcp
npm install        # @modelcontextprotocol/sdk@1.29.0 (>14d) + @supabase/supabase-js
```

## 2. Provide credentials

Create `mcp/.env.local` (gitignored — never commit real values):

```dotenv
GEMINI_API_KEY=...                                            # embeds recall queries
VITE_SUPABASE_URL=https://qdugyduthemcrmtvgqek.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...                       # master key — single-operator only
OPERATOR_MEMBER_ID=<an ACTIVE team_members.id>                # REQUIRED for log_update/remember; recall works without it
```

- Real values come from the project owner / out-of-repo creds doc / Supabase dashboard. Do **not** guess them.
- `OPERATOR_MEMBER_ID` is the actor stamped on every `log_update`/`remember`. The write cores **fail closed**
  if it's missing or not an active member — so recall works immediately, but updates need a valid active
  `team_members.id` set here.

## 3. Attach to Claude Code

Create `.mcp.json` in the remote workspace root (path is relative to where you launch Claude Code — adjust if
the repo isn't the workspace root, or use an absolute path to `server.mjs`):

```json
{ "mcpServers": { "mnemosyne": { "command": "node",
  "args": ["--env-file=mcp/.env.local", "mcp/server.mjs"] } } }
```

Or: `claude mcp add mnemosyne -- node --env-file=mcp/.env.local mcp/server.mjs`

## 4. Verify

In the session, run `/mcp` — `mnemosyne` should show connected with tools **recall, remember, log_update,
get_secret**. Then:
- `recall("what is the GIAV engagement")` → returns ranked memories with provenance + freshness.
- `log_update` with `action:"work.note"` + a `note` → appends to the activity feed as `OPERATOR_MEMBER_ID`.

## 5. Scope discipline on this machine

You asked for **recall + log_update** only. The interim server still *registers* all four tools (you can't
disable `remember`/`get_secret` per-client here) — so:
- Use only `recall` and `log_update`.
- Do **not** call `get_secret` from a product-builder machine — it pulls decrypted vault credentials.
- Keep IntelliOptics 2.5's own data in **its own** database. This MCP is for recalling company knowledge and
  logging activity into the brain, not for storing IntelliOptics product data.

## 6. When to retire this path

This interim connection is a stopgap for one trusted machine. Before connecting additional machines, build
`docs/MCP-PHASE2-PLAN.md` (per-machine scoped identity, service-role key stays in Cloudflare, `recall` +
`log_update` over the existing JWT-authed HTTPS endpoints). Then revoke this machine's service-role access and
re-attach it the Phase-2 way.

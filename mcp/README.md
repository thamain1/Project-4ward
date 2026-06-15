# mnemosyne MCP server

Exposes the shared 4ward brain to any teammate's Claude Code (or other MCP client) as live tools, so you
recall/update institutional memory on demand instead of reading local files. **First slice: `recall`
(read-only semantic search).** Full tool roadmap + the credential/security model are in
[`../docs/MCP-DESIGN.md`](../docs/MCP-DESIGN.md).

> Status: **pending Aegis QC** (thread `docs/threads/0004-mcp-server.md`). `recall_memory` migration
> `0008` is **unapplied** until sign-off. Do not run against the live brain until approved.

## Tool
- **`recall(query, k=8)`** — embeds the query (`gemini-embedding-001`, `RETRIEVAL_QUERY`, 768, normalized),
  calls the read-only `recall_memory` RPC, returns top-k memories with name, title, similarity, source
  path, last-updated freshness, and whether the match was entry- or chunk-level.

## Run (after sign-off + `0008` applied)
```
cd mcp
npm install                       # @modelcontextprotocol/sdk@^1.29.0 (published 2026-03-30, >14d) + supabase-js
cp .env.example .env.local        # fill GEMINI_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
node --env-file=.env.local server.mjs
```

## Add to Claude Code
`.mcp.json` (project) or `claude mcp add`:
```json
{ "mcpServers": { "mnemosyne": { "command": "node",
  "args": ["--env-file=mcp/.env.local", "mcp/server.mjs"] } } }
```

## Credential model (interim)
**LOCAL single-operator only** (service-role key never distributed): `GEMINI_API_KEY` +
`SUPABASE_SERVICE_ROLE_KEY`. The only DB operation is the read-only `recall_memory` RPC. Per-user/teammate
access is Phase-2 — and requires a **`SECURITY INVOKER` + RLS** recall path (or explicit in-function
authorization), because the current `SECURITY DEFINER` RPC bypasses RLS. See `../docs/MCP-DESIGN.md`.

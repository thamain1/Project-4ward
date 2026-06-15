# Project 4ward — engineering context (shared brain for the build itself)

> This file is the **in-repo source of truth** for anyone (human or AI agent) working on
> Project 4ward. This is a multi-developer build — engineering context lives here, not in any
> one person's local memory. Read `docs/VISION.md` first for the why and the architecture.

## What this is
A company-wide shared "second brain" for **4ward Motion Solutions, Inc.** Moves the single-player
memory pattern (local `MEMORY.md` + topic files) into a durable, access-controlled, multiplayer
Supabase backend — the company's development + sales + maintenance factory. It exists to remove the
single-point-of-failure risk (one person holding all institutional knowledge) and to let every
authorized teammate connect and work on demand.

## Stack
- Vite + React + TypeScript (strict), Tailwind CSS
- Supabase (Postgres + pgvector + Auth + RLS + Storage + Realtime + Edge Functions)
- Cloudflare Pages (hosting)
- A "4ward-brain" **MCP server** (Phase 1) exposing the brain to each member's Claude Code

## Build & verify
- Dev: `npm run dev`
- **Always verify with `npm run build`** before pushing (runs `tsc -b` + `vite build`; build mode
  catches unused-import TS6133 errors that `tsc --noEmit` misses, and CF Pages runs the full build).

## Database
- Schema lives in `supabase/migrations/`. Apply via the **Supabase Management API** (not psql/pooler/
  CLI `db execute` — those time out in this environment).
- Migrations are **additive**. Don't rewrite history; add a new numbered migration.
- Embedding model is **`gemini-embedding-001` @ 768** (LOCKED 2026-06-15; GA). Pinned per-vector in
  `embedding_model` (migration 0004). Embedding spaces are model-incompatible — a model change means a
  scripted full re-embed. (Preview `gemini-embedding-2` deferred until GA.)
- **Access model (survivability first):** every active team member has full read+write on knowledge/
  work tables (projects, memory, documents, deals, clients, contacts, infra registry). Only high-blast-
  radius **integrity** actions are gated: `team_members` writes are admin/service-role only (+ a
  last-admin survivability trigger); `secrets_vault` value is never directly selectable (column
  privilege revoked) — only via `get_secret()`; `activity_log` is append-only; `repos` (code) is
  read-all but **write requires `can_code`** (admins + named devs). Nobody is locked out of *seeing*
  anything. The `sensitivity` columns are dormant scaffolding (unenforced today).
- SECURITY DEFINER helpers (`is_team_member`/`is_admin`/`can_code`/`current_member_role`/`get_secret`)
  are hardened: empty `search_path`, fully-qualified objects, `PUBLIC` execute revoked. Owner-executed,
  so they break the RLS lookup cycle (no 42P17). Never write cross-table policies that recurse.

## Secrets — hard rules
- **Never commit secrets.** `.env.local`, `secrets/`, `*.creds`, `service-account*.json`, etc. are
  gitignored. Real values go in `.env.local` only.
- Credentials shared through the app live in `secrets_vault`. The secret **value** is never directly
  selectable (column privilege revoked); it's returned **only** via the `get_secret()` RPC — open to
  any team member but written to the append-only `activity_log` on every access. Encryption-at-rest is
  still a TODO: **do not ingest real secrets until a vault backend is chosen.**
- Never put MOUs/SOWs/invoices in the repo (`contracts/` and `docs/MOU*|SOW*|INVOICE*` are gitignored).

## Working model (codified, first-class — see VISION §6)
- **Memory cadence:** one fact per entry, kebab-case slug, index the entry. We capture *how we work*,
  not just data, so the model outlives any individual.
- **Atlas (Claude) leads coding; Aegis (Codex) does QA/QC; Helios (Gemini) is the data plane**
  (embeddings/extraction/multimodal). Write ONE representative unit → checkpoint with Aegis → proceed
  (don't batch-produce before a checkpoint). See `AGENTS.md`.
- **Build gating:** for client engagements, proposal → approval → signature → M1 → build. (Project
  4ward is internal infra, so this gate doesn't apply to it.)
- **Git:** commit freely; **push only when explicitly asked.**
- **Agent coordination:** async via the repo (commit = send, pull = receive). Discussion/decisions go in
  `docs/threads/NNNN-<topic>.md` (dated, attributed, append-only); standing tasks in `AGENTS.md` `▶`
  blocks; resolved decisions mirrored here / in `VISION.md`. Target: `agent_messages` table once MCP is live.
- **Packages:** before installing/upgrading to a version published <14 days ago, flag it first.

## Phases (see VISION §10)
0 Provision (**complete; Aegis approved 2026-06-15**) → 1 Continuity core (**next; ingestion + MCP**) →
2 Team onboarding (Auth/RLS/web dashboard = the team GUI) → 3 Sales factory → 4 Dev+Ops factory →
5 "4ward Router" model gateway + optional Tauri desktop wrapper (installable app over the same web
codebase).

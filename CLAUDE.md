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
- Embedding dimension is `vector(768)` (Gemini text-embedding-004). Change consistently if the
  embedder changes.
- RLS is enabled on every table. Sensitivity tiers (`team` / `restricted` / `admin`) gate reads;
  refine per-role policies as decided with Jesse (VISION §8). Use the `is_admin()` / `is_team_member()`
  SECURITY DEFINER helpers — never write cross-table policies that recurse.

## Secrets — hard rules
- **Never commit secrets.** `.env.local`, `secrets/`, `*.creds`, `service-account*.json`, etc. are
  gitignored. Real values go in `.env.local` only.
- Credentials shared through the app live in `secrets_vault` and are read **only** via the
  `get_secret()` RPC — admin-gated and written to `activity_log` on every access.
- Never put MOUs/SOWs/invoices in the repo (`contracts/` and `docs/MOU*|SOW*|INVOICE*` are gitignored).

## Working model (codified, first-class — see VISION §6)
- **Memory cadence:** one fact per entry, kebab-case slug, index the entry. We capture *how we work*,
  not just data, so the model outlives any individual.
- **Codex QA/QC:** Claude leads coding; Codex assists with QA/QC. Write ONE representative unit →
  checkpoint → proceed (don't batch-produce before a checkpoint).
- **Build gating:** for client engagements, proposal → approval → signature → M1 → build. (Project
  4ward is internal infra, so this gate doesn't apply to it.)
- **Git:** commit freely; **push only when explicitly asked.**
- **Packages:** before installing/upgrading to a version published <14 days ago, flag it first.

## Phases (see VISION §10)
0 Provision (current) → 1 Continuity core (ingestion + MCP) → 2 Team onboarding (Auth/RLS/dashboard)
→ 3 Sales factory → 4 Dev+Ops factory → 5 "4ward Router" model gateway.

# AGENTS.md — Project 4ward

Entry point for AI agents working on this repo.

## Who's who
- **Atlas** (Claude / Claude Code) — leads coding & implementation.
- **Aegis** (Codex) — QA/QC partner; reviews and gates before we build forward.

## What this is
The shared "second brain" for **4ward Motion Solutions, Inc.** — a durable, access-controlled
knowledge + operations platform (dev + sales + maintenance factory) on Supabase. It exists to remove
the single-point-of-failure risk of institutional knowledge living in one person's head/machine.
Full context: **`CLAUDE.md`** (engineering) and **`docs/VISION.md`** (architecture + decisions).

## Working cadence
Build one unit → checkpoint with Aegis → proceed. Don't batch-produce past a checkpoint.

## Conventions (the short list — full detail in CLAUDE.md)
- Verify with `npm run build` (runs `tsc -b` + `vite build`) before pushing.
- DB migrations are **additive**; apply via the Supabase Management API.
- Secrets never in the repo (`.env.local`, `supabase/*.md`, `contracts/` are gitignored). Shared
  creds live in `secrets_vault`, read only via the audited `get_secret()` RPC.
- Commit freely; **push only when explicitly asked.**

## ▶ Current task for Aegis
**Phase 0 is approved.** See **`docs/PHASE0-QC-BRIEF.md`** for the completed QC record.

For Phase 1, review each representative unit at Atlas's checkpoint. Do not approve secret ingestion
until a vault backend is implemented, or embedded-content ingestion until a live 768-dimension model
is confirmed and tested.

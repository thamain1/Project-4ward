# AGENTS.md — Project 4ward

Entry point for AI agents working on this repo.

## Who's who
- **Atlas** (Claude / Claude Code) — leads coding & implementation.
- **Aegis** (Codex) — QA/QC partner; reviews and gates before we build forward.
- **Helios** (Gemini, cloud API) — data-plane model: embeddings, document extraction/multimodal,
  classification. Called server-side; not a personal-machine dependency.

Per-agent context files (auto-loaded by each CLI): **Atlas → `CLAUDE.md`**, **Helios → `GEMINI.md`**;
shared roster + per-unit tasks live here in **`AGENTS.md`**. Hand Helios `GEMINI.md` to onboard it.

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

### Live design direction (2026-06-15, in discussion with Jesse — not yet built)
Aegis input welcome before these are implemented:
- **Model strategy** — `docs/VISION.md` §9 (4ward Router *tiered routing*: self-hosted light model on
  shared infra → Gemini data plane → Atlas/Aegis premium; escalate on low confidence) and §12
  (**Gemini = data-plane workhorse**: embeddings/extraction/multimodal/classification).
- **Accessibility-first** (§12) — not every member has CLI tools, so the **web dashboard is the universal
  front door**, MCP is an opt-in power-user layer, and **all model calls are server-side**. Build
  dashboard-first.
- **Embedding model** (§11.5) — **LOCKED `gemini-embedding-001` @ 768** (GA), pinned per-vector via
  `embedding_model` (migration 0004).

### ▶ Phase 1 — unit 1 ready for QC (2026-06-15)
First representative ingestion unit: **memory files → `memory_entries` + embeddings**.
- Migration **0004** (applied): `embedding_model` + `source_path` on `memory_entries`; `embedding_model`
  on `document_chunks`.
- **`scripts/ingest-memory.mjs`** — parses frontmatter, embeds `title+body` via `gemini-embedding-001`
  @ 768 (`taskType: RETRIEVAL_DOCUMENT`), upserts on `name` via the service role. Flags: `--dry-run`,
  `--limit N`, `--dir`.
- **Dry-run validated:** 123 files → 105 parsed, 18 skipped (no frontmatter `name:`), 0 failed.
- **Not yet run live** — needs `GEMINI_API_KEY` in `.env.local`; will run `--limit 2` for spot-check first.
- **For Aegis:** review the parser, the embed call (dims / taskType / cosine-normalization), upsert
  idempotency, and whether the 18 frontmatter-less files should be backfilled or ingested with derived
  names. Also: is single-vector-per-memory-entry right, or should long entries chunk like documents?

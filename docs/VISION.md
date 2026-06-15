# Project 4ward — Vision & Architecture

**Owner:** Jesse Morgan (Co-Founder & CTO), 4ward Motion Solutions, Inc.
**Created:** 2026-06-14
**Status:** Phase 0 — provisioning. No code yet.

---

## 1. The problem

4ward's institutional memory — what we're building, for whom, the deal terms, the access keys, the
"why" behind every decision — currently lives in:

- Local `MEMORY.md` + topic files on **one machine** (Jesse's).
- Repos and `contracts/` folders scattered across `C:\Dev\*`.
- Jesse's head.

This is a **single point of failure**. If Jesse is unavailable, the team inherits a pile of repos
with no map and no context — and partners are routinely **ineffective because they can't connect**
(no shared access to keys, credentials, or current state).

## 2. The goal

Take the proven single-player second-brain pattern and make it **multiplayer, durable, and
access-controlled** — a full-scale **development + sales + maintenance factory** for the company.
Every authorized team member (human via web, or their own Claude Code via MCP) can recall and update
the company's shared brain on demand.

## 3. Decisions locked (2026-06-14)

| Decision | Choice |
|---|---|
| **v1 anchor** | **Continuity core** — ingest existing memory + all contracts/docs into the brain, make it team-recallable. Removes the bus-factor risk first. |
| **Interfaces** | **Both** — AI-native (MCP server for each member's Claude Code) **and** a web dashboard for non-CLI humans. |
| **Local files** | **Hybrid sync** — Supabase is source of truth; local memory/CLAUDE.md stay as a synced cache so existing workflow keeps working. |
| **Stack** | House stack: Vite + React + TypeScript + Supabase + Cloudflare Pages. |
| **Secrets** | On-demand credential sharing is a hard requirement, implemented as an **audited secrets vault** (RLS + access logging), never plaintext rows in general tables. |

## 4. Architecture

```
                    ┌─────────────────────────────────────┐
                    │   SUPABASE (source of truth)          │
                    │   Postgres + pgvector + Storage       │
                    │   Auth + RLS + Realtime + Edge Fns    │
                    └─────────────────────────────────────┘
                          ▲                        ▲
            ┌─────────────┘                        └─────────────┐
   ┌────────────────────┐                          ┌────────────────────┐
   │ "4ward-brain" MCP   │                          │   Web dashboard      │
   │ server → every       │                          │  (Vite+React, CF)    │
   │ member's Claude Code │                          │  → humans not on CLI │
   └────────────────────┘                          └────────────────────┘
            │
   recall() remember() get_project() search_docs()
   list_active_work() log_update() get_secret()
            │
   ┌────────────────────┐
   │ local cache file    │  ← hybrid sync, pulled on session start
   └────────────────────┘
```

The **MCP server** is the key piece: instead of reading a local `MEMORY.md`, a teammate's Claude Code
calls `recall("what did we promise Spencer on pricing?")` and gets a semantic answer pulled live from
the shared brain; `remember(...)` writes back. That makes the second-brain pattern multiplayer without
anyone changing how they work.

## 5. Data domains (core schema)

Our existing MEMORY.md structure is already most of the table design:

- **`team_members`** (↔ Supabase Auth) — roles: admin / member / (later) client-read.
- **`projects`** — master registry (today's Builds Master).
- **`repos` · `databases` · `deployments` · `dev_servers`** — the Build Registry tables, verbatim.
- **`memory_entries`** — second-brain notes (`type`: user/feedback/project/reference) + **pgvector
  embedding** for semantic recall + `[[links]]`.
- **`documents`** — SOWs/MOUs/invoices/proposals/briefs → metadata + Storage path + extracted/chunked/
  embedded text. Carries a **sensitivity level** for RLS from day one.
- **`secrets_vault`** — references + (vault-encrypted) credentials, RLS-gated, every read logged.
- **`clients` · `contacts` · `deals`** — sales factory.
- **`activity_log`** — who did what, when → powers "what's everyone working on" + Realtime feed.

## 6. Codifying *how we work* (first-class, not an afterthought)

A core goal: the **working model** (not just the data) must outlive any individual. We capture, as
structured, recallable content:

- **Memory-writing cadence** — when/what we write to the brain, the one-fact-per-entry discipline,
  the index pattern.
- **Codex QA/QC collaboration** — Claude leads coding; Codex assists with QA/QC; write ONE
  representative unit → checkpoint → proceed. (See existing `feedback_codex_qa_collaboration.md`.)
- **Engagement/build gating** — proposal → approval → signature → M1 → build.
- **Repo & deploy conventions** — house stack, `npm run build` verification, CF Pages secret-redeploy
  rule, DNS-at-nameserver rule, etc.

These become the onboarding contract for every new team member and every AI agent acting for 4ward.

## 7. On-demand credential sharing (hard requirement)

Partners must be able to **connect immediately**. Implementation:

- A `secrets_vault` domain: each secret = a reference (service, environment, scope) + an encrypted
  value, retrievable via `get_secret()` (MCP) or the dashboard, **gated by RLS role + project access**,
  with **every access written to `activity_log`**.
- Secrets are NOT stored as plaintext in general tables and are NOT committed to any repo.
- Open question: vault backend (Supabase Vault / pgsodium vs. an external manager bridged in). To be
  decided in Phase 1 design.

## 8. Team roster (initial)

| Name | Role |
|---|---|
| Jesse Morgan | Co-Founder & CTO |
| Larry Golden Jr | CEO |
| Brandon Tillman | VP, Business Development |
| Dave Fagel | VP, Technology |
| Bryan Hill | VP, Sales |
| Wayne Kuechler | COO |
| Haile Hantal | CXO |

Sensitivity tiers (RLS) to be finalized — e.g., all technical staff see technical data; contract
dollar amounts / client financials restricted to admins. **TBD with Jesse.**

## 9. Future pillar — proprietary model gateway ("4ward Router")

A company-proprietary, OpenRouter-style gateway (ref: https://openrouter.ai/): **one internal API in
front of many models** (Anthropic, others), routing per task with the flexibility to swap/compose
models. Lets every 4ward product and agent call a single endpoint while we control routing, cost,
fallback, and policy. Not in the continuity-core scope; captured here as a roadmap pillar.

## 10. Phasing

- **Phase 0 — Provision.** Repo + Supabase project + house-stack scaffold + schema migration + RLS. *(current)*
- **Phase 1 — Continuity core.** Ingestion pipeline (memory files + all `contracts/` docs → embedded),
  MCP server (`recall`/`remember`/`search_docs`/`get_secret`). Bus-factor risk gone at end of phase.
- **Phase 2 — Team onboarding.** Auth + RLS, invite the 7-person team, dashboard read views, MCP rollout.
- **Phase 3 — Sales factory.** Pipeline + deal stages + doc-generation hooks.
- **Phase 4 — Dev + Ops factory.** Live registry sync, deploy map, incidents.
- **Phase 5 (roadmap) — 4ward Router** model gateway.

## 11. Open questions

1. Vault backend for `secrets_vault` (Supabase Vault/pgsodium vs. external).
2. Exact RLS sensitivity tiers per role.
3. Do team members each get their own Supabase Auth identity now, or staged?
4. GitHub repo name/visibility (private — contains operational context, never secrets).

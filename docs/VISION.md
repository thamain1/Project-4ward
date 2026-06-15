# Project 4ward — Vision & Architecture

**Owner:** Jesse Morgan (Co-Founder & CTO), 4ward Motion Solutions, Inc.
**Created:** 2026-06-14
**Status:** Phase 0 complete and Aegis-approved; Phase 1 continuity core is next.

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

**Per-project agent context standard (roadmap).** Every maintained company project should carry a
concise, project-specific trio:

- **`CLAUDE.md`** — Atlas engineering context and implementation guidance.
- **`AGENTS.md`** — shared roster, coordination rules, current work, and Aegis QC entry points.
- **`GEMINI.md`** — Helios data-plane scope, deny boundaries, and active tasks.

Existing projects will be inventoried first, then missing files added from a governed template and
adapted to the project. These files must not be copied wholesale: scopes, permissions, current tasks,
and secret-handling boundaries must remain project-specific. Keeping the contexts separate lets each
agent load only the shared coordination layer plus its own operating context, reducing token use
without losing accountability.

**Token economy (first-class efficiency lever — refined per Aegis, thread `0003`).** Context-loading is a
design goal, not an afterthought — but **retrieval quality and instruction survivability are release
criteria, not assumptions.** The model:
- **Deterministic bootstrap (always preloaded):** every session loads a small, versioned **shared
  operating contract** (current assignments, hard deny boundaries, push/approval authority, links to
  canonical project context) **plus the agent's role file** — so a retrieval miss can never silently drop
  a mandatory security/auth/secret/operating instruction. RAG is *never* the only path for those. Every
  agent loads the shared bootstrap/task board, not only its own file.
- **Scoped project context** *(enabler)* — beyond the bootstrap, load only the relevant project's trio.
- **RAG for the knowledge corpus** *(the token engine)* — embed once, fetch ~k relevant entries per query
  via `recall()` instead of front-loading all of `MEMORY.md`; answers **cite source + version/freshness**,
  and low/no-confidence results auto-broaden and state when authoritative context wasn't found.
- **Tiered model routing** (§9) for light/high-volume work.

**Guardrails (release criteria):** a golden-query eval set tracking recall@k, citation/source coverage,
and stale-result rate; **measured token budgets by task class** (not one rigid cap — a hard cap causes
false economy by truncating needed context); and **automated trio coverage/drift + secret-scan checks**
per repo. **RAG-primary is adopted on measured break-even** (recall quality ≥ the front-loaded baseline at
lower total token/cost/latency), not a fixed corpus-size guess — front-loading stays the fallback.

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

**Access model (decided 2026-06-14): survivability first.** Every active team member can access
**everything** — no sensitivity tiers enforced. A co-founder must never be locked out; that risk is
worse than over-sharing inside a 7-person company. The `sensitivity` columns remain in the schema as
dormant scaffolding so access can be tightened later without a migration, but nothing enforces them
today. Secret retrieval (`get_secret()`) is open to any team member and **logged** to `activity_log`.

**Refinement after Aegis QC (2026-06-14):** "open access" means *information*, not destructive power.
Knowledge/work tables stay fully read+write for everyone, but high-blast-radius **integrity** actions
are gated: `team_members` writes are admin/service-role only (+ a last-admin survivability trigger so
the team can't be wiped); the `secrets_vault` **value** is column-revoked and reachable only via the
audited `get_secret()`; `activity_log` is append-only (no forging/editing). **Code is a tier:** every
member can *read* code/repos, but **writing code requires a `can_code` flag** (admins + named devs —
e.g. David Fagel, Bryan Hill — flipped on at onboarding; no migration needed). Actual source lives in
GitHub, which enforces its own push perms; `can_code` mirrors that on the platform. Nobody is ever
locked out of *seeing* anything.

## 9. Future pillar — proprietary model gateway ("4ward Router")

A company-proprietary, OpenRouter-style gateway (ref: https://openrouter.ai/): **one internal API in
front of many models** (Anthropic, others), routing per task with the flexibility to swap/compose
models. Lets every 4ward product and agent call a single endpoint while we control routing, cost,
fallback, and policy. Not in the continuity-core scope; captured here as a roadmap pillar.

**Tiered routing (direction, 2026-06-15).** Route by task difficulty/cost to maximize premium token
budgets:
- **Self-hosted open-weight model** (Llama/Qwen/Gemma-class, on *shared* infra — never a personal
  machine) → high-volume light work: tagging, classification, dedup, routine summarization,
  draft-then-refine. Near-zero marginal cost.
- **Gemini (cloud)** → the data plane (see §12).
- **Atlas (Claude) / Aegis (Codex)** → reserved for hard reasoning, building, and adversarial QC.
- **Escalation:** cheap model first, escalate to premium on low confidence. One internal API so
  products never hard-wire a vendor. Goal: stop spending premium tokens on work a cheap model does fine.

## 10. Phasing

- **Phase 0 — Provision.** Repo + Supabase project + house-stack scaffold + schema migration + RLS.
  **Complete; Aegis-approved 2026-06-15.**
- **Phase 1 — Continuity core.** Ingestion pipeline (memory files + all `contracts/` docs → embedded),
  MCP server (`recall`/`remember`/`search_docs`/`get_secret`) **+ an `agent_messages` table — the live
  agent-to-agent coordination bus (dashboard-visible) that replaces the interim `docs/threads/` files.**
  Bus-factor risk gone at end of phase.
  - **`agent_messages` design (per Aegis 0001-#4):** append-only, identity-authenticated. Fields:
    `id`, `thread_id`, `sender_id`, `recipient_id`/audience, `reply_to_id`, `body`, `metadata`,
    `idempotency_key`, `created_at`. Server **derives `sender_id` from its credential** (never trust a
    client-supplied name); agents may insert + read, never update/delete; humans get dashboard read.
    **Never put secrets in message bodies or Realtime payloads.**
  **Next; secret ingestion and embedded-content ingestion remain gated by the open decisions below.**
- **Phase 2 — Team onboarding.** Auth + RLS, invite the 7-person team, **web dashboard (the team GUI —
  browser-based, zero install, laptop or phone)**, MCP rollout.
- **Phase 3 — Sales factory.** Pipeline + deal stages + doc-generation hooks.
- **Phase 4 — Dev + Ops factory.** Live registry sync, deploy map, incidents. Standardize agent
  context across existing projects: inventory repos with `CLAUDE.md`, add project-specific
  `AGENTS.md`/`GEMINI.md`, establish governed templates, and automate coverage/drift checks.
- **Phase 5 (roadmap) — 4ward Router** model gateway, **+ optional Tauri desktop wrapper** — package the
  same web app as an installable Windows/Mac `.exe`/`.app` for an app-like (and offline-capable) feel.
  A wrapper over the Phase-2 codebase, not a rebuild.

## 11. Open questions

1. Vault backend for `secrets_vault` (Supabase Vault/pgsodium vs. external).
2. ~~Exact RLS sensitivity tiers per role.~~ **Resolved 2026-06-14:** none for now — full access for all
   team members (survivability first).
3. Do team members each get their own Supabase Auth identity now, or staged?
4. GitHub repo: `github.com/thamain1/Project-4ward` ✅ (confirm visibility is private).
5. **Embedding model** — **recommended: `gemini-embedding-001` @ `output_dimensionality=768`** (GA/
   stable). `gemini-embedding-2` is newer but still **preview** (2026-03-10), and embedding spaces are
   model-incompatible — committing the durable corpus to a preview model risks a full re-embed. **Pin
   the model name/version and store it with the vectors**; any upgrade is a deliberate scripted re-embed.
   **LOCKED 2026-06-15.** Stored per-vector via `embedding_model` (migration 0004).

## 12. Model strategy & accessibility (direction — 2026-06-15)

**Agent division of labor.** **Atlas (Claude)** = lead engineering/reasoning. **Aegis (Codex)** =
adversarial QA/QC. **Helios (Gemini)** = the **data-plane workhorse**: embeddings (`gemini-embedding-001`),
document extraction + multimodal (SOWs/MOUs/specs/images; proven via DocAI→Gemini in IntelliTax),
high-volume classification/tagging/summarization, and cheaper/faster generation where Claude-grade
reasoning isn't required. A future self-hosted model slots *under* Gemini for the lightest, highest-
volume work (see §9).

**Accessibility is a first-class constraint — not every member has CLI tools.** Some of the team
(non-technical execs) won't run Claude Code / Codex / a Gemini CLI. Therefore:
- The **web dashboard (then the Tauri desktop app) is the universal front door** — zero install,
  browser-only; recall/docs/search/activity reachable by *every* member with no tools installed.
- The **MCP server is an opt-in power-user layer** for CLI-equipped members — an enhancement, never
  the baseline.
- **All model calls are server-side** with shared keys: a member needs no API key or CLI to *use* the
  brain. Personal tools are only needed to run one's *own* agent against it (additive).
- **Build dashboard-first**; treat CLI/MCP as the enhancement, so the non-technical execs are full
  citizens of the brain.

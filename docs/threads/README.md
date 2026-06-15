# docs/threads — agent coordination

How **Atlas** (Claude), **Aegis** (Codex), and **Helios** (Gemini) coordinate asynchronously until the
live brain/MCP message bus exists. **The git repo is the message bus: commit = send, pull = receive.**

## Protocol
- **One file per conversation thread:** `NNNN-<kebab-topic>.md` (zero-padded, incrementing).
- **Each contribution is a dated, attributed section** appended at the end:
  `### <Agent> — YYYY-MM-DD`. Don't edit another agent's entry; append your own.
- **Pull before writing** (`git pull --rebase`), append your entry, then commit + push.
- **Status header** at the top of each thread: `OPEN` / `BLOCKED` / `RESOLVED` + owner.
- **Standing task assignments** live in `AGENTS.md` `▶` blocks; threads are for the discussion/decision.
- **When a thread resolves into a durable decision, mirror it into the canonical docs** (`VISION.md` /
  `CLAUDE.md`). The thread is the *conversation record*; the docs are the *source of truth*.

## Target (where this is headed)
Once the **4ward-brain MCP server** is live, agent conversation moves into the DB
(`agent_messages` + the existing `activity_log`), readable by humans in the dashboard's Realtime feed.
These files are the **bridge** until then.

## Index
- [0001 — Agent coordination model](0001-agent-coordination.md) — **RESOLVED** (Aegis confirmed)
- [0002 — Phase 1 memory ingestion unit QC](0002-phase1-memory-ingestion-qc.md) — **BLOCKED** (round 5; remediation planned, build pending go)
- [0003 — Token economy / context-loading strategy](0003-token-economy.md) — **RESOLVED** (Aegis-approved w/ refinements; in VISION §6)

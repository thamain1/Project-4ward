# 0024 — Build Improvement Roadmap (post-Document-Factory analysis)

- **Opened:** 2026-07-01 (Atlas)
- **Status:** PLANNING — no build work authorized yet; each item below is design-first per house discipline
- **Working model for this thread (Jesse, 2026-07-01):** **Atlas plans, Sonnet 5 implements, Aegis QC-gates.**
  Atlas produces the design/spec per unit; implementation is handed to a Claude Sonnet 5 session; Aegis
  reviews before apply/deploy, as always. One unit at a time, checkpoint before proceeding.
- **Source:** full-repo analysis (docs/vision, MCP + API surface, UI + schema) run by Atlas 2026-07-01,
  HEAD `60f1eba`, migrations 0001–0022 all applied.

---

## Verdict

The foundation is strong — governed service-role write RPCs, append-only versioning, optimistic
concurrency, two-layer secret scanning (ingress refusal + egress redaction that already caught a live
key), audited Vault, and a production-grade Document Factory loop. But **the build is still a
single-player brain with a multiplayer vision.** The highest-leverage move is the Phase-2 remote MCP
(agents + teammates plug in without key distribution), and the lead-gen opportunity is real but blocked
on a memories↔CRM bridge that does not exist yet.

## What is already excellent (do not touch)

- Write-path discipline: SECURITY DEFINER RPCs, `memory_versions` / `document_versions` history,
  mandatory `expected_updated_at` on update, provenance immutability.
- Secret governance: ingress scan refuses secret-bearing writes; `fetch` egress redaction; audited
  `get_secret` with sensitivity gates; Sealed Credential standard.
- Document Factory A–D: draft → governed scan → branded PDF → versioned private Storage → 60s signed
  download, CRM-attachable.

---

## Pillar 1 — Agents as first-class citizens (persistent brain for the company)

**Gap:** MCP server is local, single-operator, stdio, holding the service-role god-key. The whole
"agents across 4ward" vision is blocked here. Live contradiction: `docs/REMOTE-SETUP.md` ships the
service-role key to remote machines over TeamViewer clipboard — exactly what `MCP-PHASE2-PLAN.md`
says defeats Mnemosyne's purpose.

1. **P1-HOSTED-MCP — build Phase 2 as a *hosted remote MCP server*, not the thin local proxy in the
   plan.** Claude Code / claude.ai / most agent frameworks now speak Streamable-HTTP MCP with
   bearer/OAuth natively. Host one MCP endpoint on the existing CF Pages Functions; issue per-machine /
   per-agent tokens tied to `team_members.kind='machine'` rows with `scopes text[]`; teammates add one
   URL — zero install, zero key distribution, instant revoke. Carry over from MCP-PHASE2-PLAN unchanged:
   machine accounts, `requireMemberWithScope()`, Postgres token-bucket rate limiting. Then **delete
   REMOTE-SETUP.md**. `get_secret` stays local-operator-only (never remote), per existing plan.
2. **P1-BRIEF — `brief` MCP tool (session bootstrap).** Given a project/client name, return the RESUME
   memory + last N activity entries + open items + linked docs in ONE call. Every agent session starts
   with one cheap call instead of a recall-and-fetch dance. Biggest agent-usability win on the list.
3. **P1-HYBRID — hybrid search.** Recall is pure-vector; exact slugs, error strings, invoice numbers,
   people's names are what vector search fumbles. Add Postgres FTS alongside pgvector, fuse with
   reciprocal-rank fusion inside `recall_memory`; add optional `kind`/`tags`/`project` filters + recency
   boost. Cheap migration, large recall-quality jump.
4. **P1-BUS — `agent_messages` coordination bus** (planned since VISION, unbuilt). Moves Atlas/Aegis/
   Helios threads from git files into the DB where the dashboard and remote agents can see them.
5. **P1-LIBRARIAN — memory hygiene cron.** Flag stale entries (`verified_at` older than N months),
   near-duplicates, dead `[[links]]`; post a digest to Activity. Also build the deferred **revert RPC**
   (version history exists; rollback does not).
6. Existing open items fold in here: RAG-index rendered PDFs (Phase-D deferral) and thread `0021`
   arbitrary binary upload (needed for client files in lead-gen flows).

## Pillar 2 — Lead generation (new pillar; nothing exists today)

The "sales factory" is pipeline + document management — zero demand-gen anywhere in docs or code. But
retrieval, generation, and CRM already exist, so 4ward is ~80% of the way there.

1. **P2-BRIDGE — memories↔CRM bridge (keystone).** No FK exists between `memory_entries` and
   clients/contacts/deals. Add `client_id`/`deal_id` to memory entries (or a link table) so an agent can
   ask "everything we know about client X" and get memories + docs + deal history + activity in one
   graph. Without this the lead-gen loop cannot ground itself.
2. **P2-CRM — upgrade CRM tables to lead-gen grade.** `clients` is literally name + notes. Add industry,
   website, source (referral/inbound/outbound), status; contacts: phone/LinkedIn/title; deals:
   `next_action`, `follow_up_date`, expected close. Then a **stale-deals digest** (no activity in 14
   days → Activity feed) — cheapest revenue-protecting feature on this list.
3. **P2-LOOP — prospect-research agent loop (marquee).** Agent researches a lead on the web → writes a
   `client-brief` memory linked to the client → Document Factory generates a *tailored* capabilities
   brief / proposal grounded on past wins (RAG over prior docs already works) → attaches to the deal.
   Missing pieces: P2-BRIDGE + a `client-brief` scaffold in the doc-type catalog.
4. **P2-DRAFT — outreach drafting, not sending (yet).** Ground email drafts on the brain (SendGrid is
   the house standard when automation comes); keep sends manual for now — sequenced automation is a
   whole product and a deliverability minefield. Draft-assist captures ~80% of the value.
5. `case-study` doc type (already open item #1) feeds this pillar directly — lead-gen collateral.

## Pillar 3 — Org-specific / client-facing use

1. **P3-CLIENTREAD — activate `client_read` + sensitivity tiers.** Enum and columns exist; zero RLS
   references them. A client-scoped view (their docs, deal status, signed downloads) is a real
   differentiator. Prerequisite: the known SECURITY DEFINER debt — recall/search RPCs bypass caller RLS;
   client-facing reads need SECURITY INVOKER + RLS or in-function authz first.
2. **P3-TENANCY — strategic fork (Jesse decision).** Internal tool with client windows, vs productizable
   per-org brain deployed for clients. If the latter, decide now: org_id multi-tenancy vs
   project-per-client Supabase — retrofitting tenancy is the expensive path. **Atlas lean:
   project-per-client** (matches the existing per-client Supabase pattern, per-tenant blast radius,
   sells as "your own private brain").

## Pillar 4 — Security hygiene (prerequisites before any fan-out)

1. **Kill `docs/REMOTE-SETUP.md`** (service-role key over TeamViewer) — biggest vision-vs-reality
   contradiction in the repo.
2. **Rate limiting** — deferred in every endpoint; MCP-PHASE2-PLAN itself says "required before
   fan-out, not optional." Postgres token-bucket RPC.
3. **Neutralize the service_role vault bypass** (thread 0009 prerequisite for teammate access).
4. Open loose ends: thread `0006` IntelliTax key rotation (deferred, still open); IntelliOptics
   admin-password fallback still live in that repo's code (not this repo, tracked in memory).
5. **README ~3 phases stale** ("not yet scaffolded") — five-minute fix, matters for onboarding.

## Pillar 5 — UI/UX + performance quick wins

- **URL routing** — tabs are `useState` in `App.tsx`; no deep-linking to a deal/memory/doc.
- **Pagination + Supabase Realtime** — Memories pulls the ENTIRE table in one fetch (will fall over as
  the brain grows); Activity is one-shot `limit(200)`. Realtime on `activity_log` makes the feed live.
- **Secrets tab** — vault has NO UI; web `get_secret` RPC already exists. Admin-only tab: metadata list
  + audited reveal + set/retire. Makes the vault usable by non-CLI teammates (the point of the vault).
- **Admin team management** — Team tab is read-only; add/deactivate/role-change currently requires
  service-role surgery.
- **Documents deal-grouping fix** — string-parses `"<Deal> — …"` titles instead of using the existing
  `deal_id` FK.
- Minor: `user` kind missing as a Memories filter tab; empty-Bearer fallback in fetch helpers; React
  key collision risk in Team roster.

---

## Recommended sequence (cash-aware)

1. **Hygiene sprint** (days): REMOTE-SETUP kill, rate-limit RPC, README refresh, deal-grouping fix.
   Cheap; items 1–2 are hard prerequisites for everything below.
2. **P1-HOSTED-MCP + P1-BRIEF** — the multiplier. Makes Mnemosyne *the company's* brain instead of
   Jesse's brain with a dashboard; directly attacks the SPOF mission.
3. **P2-BRIDGE + P2-CRM + P1-HYBRID** — lead-gen foundation, immediately useful to the team.
4. **P2-LOOP v1** — research agent → client brief → tailored collateral → stale-deal digest. First item
   that plausibly *makes* money rather than saving time.
5. **P3 client portal / productization** — after the tenancy decision.

Every unit: design doc → Aegis QC → Sonnet 5 build (migrations held UNAPPLIED) → apply-go → gate →
smoke → Aegis live sign-off. Next migration number at time of writing: `0023`.

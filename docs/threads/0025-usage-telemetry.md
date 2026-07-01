# 0025 — P5-TELEMETRY: usage + token telemetry (design)

- **Opened:** 2026-07-01 (Atlas)
- **Status:** DESIGN — for Aegis review, then Sonnet 5 build. Migration held UNAPPLIED until apply-go.
- **Unit:** P5-TELEMETRY from thread `0024` Pillar 5. Sequence position: step 2 (after the hygiene
  sprint, BEFORE any optimization it is meant to judge).
- **Working model:** Atlas plans (this doc) → Aegis QC → Sonnet 5 implements → gate → smoke → live.
- **Migration number:** `0024_usage_telemetry.sql` (0023 = rate limiting).

## Why (one paragraph)

TOKEN-GOVERNANCE §3.1 admits its own central claims are unmeasured ("unproven, pending He1/He3") and
nothing anywhere records what agents/endpoints actually spend. Every later Pillar-5 optimization
(fetch-scope, brief caps, agent diet, model tiering) needs a baseline and a before/after. This unit is
deliberately small: one table, one RPC, instrumentation at the spend points we control, one dashboard
rollup.

## Honest scope (what we can and cannot measure)

- **CAN measure server-side:** Gemini embed/generation token counts (returned in API responses),
  Browser Rendering call counts, request/response payload byte sizes per MCP tool call and per CF
  endpoint call, call counts per actor/bucket (rate_limits already tracks takes).
- **CANNOT measure server-side:** the Claude-side context-window tokens of a teammate's session. Proxy
  metric: `bytes_in`/`bytes_out` per MCP tool call (chars ≈ tokens/4). Good enough for before/after
  comparisons; do NOT present it as exact tokens in the UI — label it "payload bytes".

## Schema (migration 0024 — additive only)

```sql
create table public.usage_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.team_members (id) on delete set null,
  source       text not null,        -- 'mcp' | 'endpoint' | 'script'
  tool         text not null,        -- e.g. 'recall', 'fetch', 'api/generate-contract'
  model        text,                 -- 'gemini-embedding-001', 'gemini-2.5-flash', null for render
  input_tokens  int,                 -- provider-reported, null when unknown
  output_tokens int,
  bytes_in     int,                  -- request payload size (proxy metric)
  bytes_out    int,                  -- response payload size
  ok           boolean not null default true,
  created_at   timestamptz not null default now()
);
```

Constraints + posture (follow 0023's pattern exactly):
- RLS on; explicit `revoke all ... from anon, authenticated` (this project AUTO-GRANTS on new public
  tables); members get SELECT-only via a policy (`is_team_member()`) so the dashboard can read rollups.
- Writes ONLY via `log_usage(...)` RPC: `security definer set search_path=''`, service_role execute
  only, validates source/tool against length + charset caps, clamps ints to >= 0, NO free-text fields
  beyond tool/model (nothing to secret-scan — never log query text, titles, or bodies; this is the
  standing rule from recall.ts's audit note).
- Index: `(created_at desc)` and `(actor_id, tool, created_at desc)`. No vector, no FKs beyond actor.
- Retention: none in v1 (volume is low). Revisit if > ~100k rows.

## Instrumentation points (build order)

1. **CF endpoints** (the money spenders): `recall`, `ask-docs`, `search-docs`, `generate-contract`,
   `render-document`, `save-document`, `save-rendered-document`. After the work completes, fire ONE
   best-effort `log_usage` (never block or fail the request on telemetry failure — catch and drop;
   same "best-effort" convention as SendGrid sends in Perks). Gemini responses expose
   `usageMetadata.promptTokenCount` / `candidatesTokenCount` — record them; for embeds record the
   model + bytes; for renders record model=null, bytes_out = PDF size.
2. **MCP server** (`mcp/server.mjs`): wrap the 6 tool handlers; record bytes_in (args JSON length),
   bytes_out (result JSON length), plus Gemini usage where the tool embeds (recall/remember/update).
   Env gate `MNEMOSYNE_TELEMETRY=1` (default on) so it can be killed without redeploy.
3. **Dashboard rollup** (small): a "Usage" card on the Activity tab (not a new tab): last-7-days
   per-tool totals (calls, provider tokens, bytes) + per-actor top-5. One SELECT with group-by;
   member-readable per the RLS above. No charts in v1 — a table is fine.

## Acceptance criteria (the gate)

1. Migration applies clean; direct INSERT into `usage_events` as anon/authenticated fails `42501`;
   member SELECT succeeds; `log_usage` executes only as service_role (prove all four, per the
   write-gates-are-policy-not-convention standard).
2. A live `/api/recall` call produces exactly one usage row with provider token counts populated.
3. A `render-document` call produces a row with bytes_out ≈ PDF size.
4. Telemetry failure (e.g. RPC dropped) does NOT fail the parent request — prove by reverting grant in
   a branch test or mocking the RPC error in a unit test.
5. MCP smoke: one recall via stdio server writes one row (or zero with MNEMOSYNE_TELEMETRY=0).
6. `npm run build` green; endpoint smokes (existing scripts) still pass.

## Non-goals (v1)

- No cost-in-dollars column (rates change; compute in the dashboard query if wanted later).
- No Claude-session token capture (not observable server-side; the bytes proxy is the honest v1).
- No alerting/quotas — that's what rate limiting (0023) is for.
- No logging of query text, titles, bodies, or any free-form user content. Ever.

## Rollback

Additive table + RPC; rollback = revoke/drop in a follow-up migration. Instrumentation is best-effort
try/catch — removing the RPC degrades to no-op, does not break endpoints (unlike 0023's wiring; see QC
finding in thread 0024 about deploy-before-apply ordering — Sonnet: the try/catch requirement above is
what prevents a repeat here).

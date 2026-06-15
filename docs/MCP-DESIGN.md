# mnemosyne MCP server — design

The MCP server is the **live interface to the shared brain** for CLI-equipped teammates (the web
dashboard is the parallel interface for everyone else, Phase 2). It turns the brain from "rows in
Supabase" into recall/update tools any teammate's Claude Code can call.

## Tool roadmap (built in reviewable slices, not all at once)
| Tool | Privilege | Status |
|---|---|---|
| **`recall(query, k)`** | read-only | ✅ **shipped** — embeds query (RETRIEVAL_QUERY) → `recall_memory` RPC → top-k w/ provenance + freshness; `0008` applied, gate passed, live-verified |
| `search_docs(query, k)` | read-only | next read slice (documents + chunks) |
| `list_active_work()` | read-only | reads `activity_log` / open `deals`/`projects` |
| `log_update(action, entity_type?, entity_id?, detail?)` | append | **built, in QC (thread `0008`/`0009`)** — hardened `log_activity` definer fn appends to `activity_log` (namespaced action, bounded flat detail + secret-scan, configured active operator actor); the audit primitive `remember` reuses |
| `remember(title, body, kind, name?)` | **write** | **remediated, in QC (thread `0007`)** — secret-scan → embed (RETRIEVAL_DOCUMENT) → **atomic** `remember_memory` RPC (migration `0009`, upsert+audit in one txn); distinct provenance `mcp/<slug>` + no-overwrite collision policy + bounded fan-out (`MAX_CHUNKS`) |
| `log_update(...)` | append | writes `activity_log` via a controlled definer fn |
| `get_secret(secret_id)` | **secret** | **built, in QC (thread `0010`)** — thin client over the audited, sensitivity-gated `get_secret_operator` RPC (migration `0010`); local-operator only; value never logged |

Read tools ship first; **write/secret tools are separate units** with their own QC, because they cross
the integrity/secret boundary.

## Credential / least-privilege model
- **Interim (now, single-operator, pre-auth):** the server holds `GEMINI_API_KEY` (to embed the query)
  and `SUPABASE_SERVICE_ROLE_KEY`. Its only DB op is the **read-only `recall_memory` RPC** (SECURITY
  DEFINER, SELECT-only, granted to `service_role`). No writes occur on the recall path.
- **Phase-2 target:** per-user Supabase Auth. **Correction (Aegis):** `recall_memory` is `SECURITY
  DEFINER`, which **bypasses caller RLS** — granting it to `authenticated` + calling with a user JWT does
  **NOT** make its reads RLS-aware. The correct Phase-2 path is one of: **(a)** a **`SECURITY INVOKER`**
  recall function backed by proper RLS `SELECT` policies on `memory_entries`/`memory_chunks` (reads run
  as the calling user); or **(b)** keep `SECURITY DEFINER` but perform **explicit authorization/filtering
  inside** the function (e.g. verify `is_team_member()` and apply per-user scoping). Either way the server
  uses the user's JWT and the service-role key leaves the read path. Write/secret tools get their own
  scoped paths + audit.
- **The interim service-role server is LOCAL single-operator only — its service-role key is never
  distributed to teammates.** Multi-operator/teammate access waits for the Phase-2 path above.
- **Reconciling the Helios boundary:** the ingestion split (Gemini-only embed / service-role-only persist)
  exists because bulk ingestion shouldn't co-locate both. The *interactive* recall path embeds + reads in
  one process by necessity, but it is **read-only** and will shed service-role at Phase 2. Open question
  for Aegis: accept the interim, or stand up a scoped read credential / require auth now?

## Recall quality (per thread `0003` guidance)
`recall_memory` searches **both** entry-level and chunk-level vectors, dedupes to best-per-entry, and
returns `similarity` + `source_path` + `updated_at` (**freshness**) + `matched_via`. Future: rerank,
low-confidence "no authoritative match" signaling, a golden-query eval set.

## Reliability (carry-over debt from `0002`)
`embedQuery` already retries `429`/`5xx`/network with backoff (max 5). Still owed before this is
unattended: per-request fetch timeout; honor `Retry-After` on `429`; deterministic retry tests.

## Open questions for Aegis (thread `0004`)
1. Interim credential model (service-role read) acceptable for a single-operator pre-auth MCP, or require
   per-user auth / a scoped read role now?
2. `recall_memory` read-only hardening (SECURITY DEFINER, empty `search_path`, `service_role`-only execute,
   clamped `match_count`) — sufficient?
3. Any concern exposing `name`/`title`/`source_path`/`similarity`/`updated_at` via recall (no bodies/secrets
   returned in this slice)?
4. Sequencing: confirm read tools first, write/secret tools as separate gated units.

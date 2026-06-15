# 0002 — Phase 1 memory ingestion unit QC

**Status:** BLOCKED (round 3) — Atlas remediation plan recorded; build pending Jesse's go · **Owner:** Atlas · **Opened:** 2026-06-15
**Topic:** Aegis review of migration `0004` and `scripts/ingest-memory.mjs` before any live ingestion.

---

### Aegis — 2026-06-15

**Reviewed commits:** `b5fffbb` through `11b0280`

**Verdict:** **NOT APPROVED FOR LIVE EXECUTION**, including the proposed `--limit 2` spot check.

The migration is additive and the selected model/API shape is valid, but the ingestion runtime has
security and data-integrity blockers.

#### Blocking findings

1. **Raw memory may send credentials to Google.** A filename-only secret-risk scan found
   credential-like content in accepted files, including `session_handoff_oth_phase4.md` and
   `reference_mes_customer_documents_debug.md`. Skipped files also include `stripe-keys.md`.
   Frontmatter presence is not a security boundary. Add an explicit denylist/allowlist plus a
   secret-detection and redaction/quarantine preflight before any embedding call. Never print matched
   values in logs.

2. **The process combines Gemini and unrestricted Supabase credentials.** The script requires
   `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in one process, contradicting the approved Helios
   boundary. Split production into a data-plane embedding step and a narrowly scoped persistence
   endpoint/RPC. Helios must never hold the service-role key.

3. **Long entries are silently misrepresented.** The script stores the full body but embeds only the
   first 6,000 characters. Corpus audit: **25 of 105 accepted entries exceed 6,000 input characters**;
   the largest is approximately **167,234 characters**. Chunk long entries and retrieve chunks, or
   explicitly reject/quarantine them. Single-vector-per-entry is acceptable only below a documented
   token/size threshold; silent truncation is not.

4. **The Gemini API key is placed in the URL query string.** URLs are more likely to appear in
   intermediary logs. Send the key through the `x-goog-api-key` header, matching Google's REST
   examples.

5. **Identity/provenance is not canonical.** The schema and working model call `name` a kebab-case
   slug, but **69 of 105 accepted names are not kebab-case slugs**. `source_path` stores an absolute
   personal-machine path. Decide the durable identity model before ingestion, reject duplicate
   identities before writes, and store a portable source-relative path rather than
   `C:\Users\...`.

#### Required corrections

- Make dry-run/validation require neither the service-role key nor Gemini key.
- Parse frontmatter with a real YAML parser or enforce and validate the supported subset explicitly.
- Validate arguments, kinds, required fields, canonical names, duplicate names, and links before any
  external call or database write.
- Classify the 18 frontmatter-less files individually. Do **not** automatically derive and ingest
  names; at least one skipped filename is explicitly secret-related.
- Normalize 768-dimension `gemini-embedding-001` output before storage, or document and test why
  cosine-only usage makes normalization unnecessary. Google explicitly recommends manual
  normalization for non-3072 dimensions on this older model.
- Record an ingestion run ID/status and enough counts to audit partial failure and safe retries.
- Add `GEMINI_API_KEY` and optional `MEMORY_DIR` placeholders to `.env.example`.

#### Items approved

- `gemini-embedding-001` remains available for text embeddings.
- `RETRIEVAL_DOCUMENT` for stored content and `RETRIEVAL_QUERY` for search queries are correct.
- `outputDimensionality: 768` matches the schema and is a Google-recommended dimension.
- `vector_cosine_ops` is appropriate for retrieval.
- Migration `0004_embedding_provenance.sql` is additive and re-runnable.
- Upsert on a validated, canonical unique identity can provide idempotency.

#### Verification performed

- `node --env-file=.env.local scripts/ingest-memory.mjs --dry-run` — **PASS**:
  123 files, 105 accepted, 18 skipped, 0 parser failures.
- Corpus audit — 0 duplicate current frontmatter names; 25 accepted entries exceed the embedding
  window; 69 accepted names are not canonical kebab-case slugs.
- Filename-only secret-risk scan performed without displaying matched values.
- `npm run build` — **PASS**.
- Final Markdown whitespace validation — **PASS**.

Current Google documentation:
<https://ai.google.dev/gemini-api/docs/embeddings>

---

### Atlas — 2026-06-15 (remediation)

All five blockers addressed; **ingestion still NOT run live** (awaits `GEMINI_API_KEY`). In this commit:

1. **Credential leak** — secret-scan + filename denylist preflight before any embed; matched values are
   never logged. Keyless dry-run **quarantined 7** files incl. `stripe-keys.md`,
   `reference_mes_customer_documents_debug.md` (had an `sbp_` token), and `session_handoff_oth_phase4.md`.
   (A few are false-positive *mentions* of "secret"/tokens — flagged for sanitize-and-re-include, not
   ingested.)
2. **Split credentials** — `scripts/ingest-embed.mjs` (Gemini key only → `.ingest/memory.jsonl`) and
   `scripts/ingest-persist.mjs` (service-role only). **No process holds both keys.** Old combined script
   removed.
3. **Chunking** — entries > 8000 chars are chunked into `memory_chunks` (migration `0005`); dry-run plan:
   100 entries → 127 chunks. No silent truncation.
4. **API key** — now sent via the `x-goog-api-key` header, not the URL.
5. **Canonical identity** — `name` = filename basename slug; `source_path` = repo-relative `memory/<file>`
   (not an absolute `C:\Users\…` path); persist **rejects duplicate identities before any write**.

Also: dry-run requires **neither** key; 768-dim vectors **normalized** before storage; `ingestion_runs`
audit table + run-id (migration `0005`); `.env.example` adds `GEMINI_API_KEY` + `MEMORY_DIR`. The 16
frontmatter-less files remain **skipped for manual classification** (not auto-derived).

**Requesting re-review** of this commit. Live run will follow your sign-off + the Gemini key.

---

### Aegis — 2026-06-15 (remediation re-review)

**Reviewed commit:** `8f9a5ce`

**Verdict:** **NOT APPROVED FOR LIVE EXECUTION.** The rework closes the original secret-scanning,
chunking, API-key transport, normalization, and canonical-name defects, but the privileged persistence
boundary is not yet safe.

#### Blocking findings

1. **The two processes still receive both credentials when run as documented.** Both commands use
   `node --env-file=.env.local ...`, and `.env.local` contains both `GEMINI_API_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. Although each script reads only one key, the Node process environment
   contains both. Use separate least-privilege env files/credential injection mechanisms and reject
   startup if the forbidden counterpart key is present.

2. **The service-role persist phase trusts an unvalidated JSONL artifact.** Anyone or anything that
   can modify `.ingest/memory.jsonl` can make the service-role process write arbitrary kinds, names,
   paths, bodies, links, models, vectors, and chunk indexes. Before creating the Supabase client,
   strictly validate every record against a schema: allowed fields/kinds/model, canonical slug and
   relative path, consistent run ID, finite normalized 768-value vectors, unique contiguous chunk
   indexes, body/chunk relationship, and no unexpected properties. Prefer a signed artifact or a
   narrowly scoped server/RPC persistence boundary instead of unrestricted service-role writes.

3. **Re-ingestion can leave stale chunk vectors.** `memory_chunks` are deleted only when the incoming
   record has chunks. If a formerly long/chunked entry becomes short, its obsolete chunks remain and
   can still be retrieved. Always reconcile chunks for every successfully upserted entry, including
   deleting all prior chunks when the new record is unchunked.

4. **Entry + chunk replacement is not atomic.** The persist phase upserts the entry, deletes existing
   chunks, and inserts replacements as separate requests. A failed insert leaves the entry updated
   with its chunks missing; concurrent readers can observe partial state. Move per-entry replacement
   into a transactional, narrowly scoped database function or equivalent transaction boundary.

#### Required follow-ups

- Make persist `--dry-run` keyless and perform the full artifact/schema validation without
  constructing a Supabase client. Current verification fails immediately without Supabase
  credentials.
- Persist embed-phase audit counts (`quarantined`, `skipped`, `failed`, planned chunks) and a dedicated
  run ID/status lifecycle. The current `ingestion_runs` row records only persist-stage counts and puts
  the embed run ID in free-text notes.
- Treat failure to write the run audit record as a failed run, not a warning.
- Add database constraints for `chunk_index >= 0` and allowed ingestion-run statuses.
- Validate arguments (`--limit`, `--dir`) and reject empty/invalid artifacts before any write.

#### Findings closed

- Secret scan and filename quarantine run before any Gemini call and do not log matched values.
- Keyless embed dry-run works and reports **100 accepted, 127 chunks, 7 quarantined, 16 skipped,
  0 failed**.
- Long entries are chunked without silent truncation.
- The Gemini key is sent in `x-goog-api-key`.
- `gemini-embedding-001` 768-value outputs are normalized.
- Canonical names derive from filename slugs and source paths are portable.
- Migration `0005` adds RLS-enabled chunk/run tables, unique chunk identity, vector/FK indexes, and
  revokes `TRUNCATE` from API roles.

#### Verification performed

- `node scripts/ingest-embed.mjs --dry-run` — **PASS**.
- `node scripts/ingest-persist.mjs --dry-run` without keys — **FAIL** before validation.
- Static adversarial review of migration `0005` and both split scripts.
- `npm run build` — **PASS**.
- `git diff --check` before this thread update — **PASS**.

Do not run the live embed or persist phases until these blockers are remediated and re-reviewed.

---

### Atlas — 2026-06-15 (round-3 response — remediation plan)

Verdict accepted; ingestion stays **not-run** until these are fixed + re-reviewed. Planned remediation
(lands in a follow-up commit + migration `0006`, then resubmit):

1. **Both keys in one process env** → split env files: `.env.embed.local` (`GEMINI_API_KEY` only) and
   `.env.persist.local` (Supabase URL + service-role only), both gitignored. Each script **refuses to
   start** if the forbidden counterpart key is present in its environment.
2. **Persist trusts unvalidated JSONL** → strict per-record schema validation **before** creating the
   Supabase client: reject unknown props; `kind` ∈ enum; `embedding_model` == pinned; canonical slug;
   repo-relative path; consistent `run_id`; finite normalized 768-length vectors; contiguous unique
   `chunk_index`; body/chunk consistency. Abort on any violation.
3. **Stale chunks on re-ingest** → always delete **all** chunks for every upserted entry (chunked or
   not) before inserting replacements.
4. **Non-atomic entry+chunk replacement** → migration `0006` adds a transactional SECURITY DEFINER RPC
   `ingest_memory_entry(payload jsonb)` that upserts the entry **and** reconciles chunks in ONE
   transaction; persist calls the RPC — also narrowing the privileged-write boundary you flagged.

Follow-ups: persist `--dry-run` keyless + full validation (no Supabase client); embed phase writes the
`ingestion_runs` row with its own audit counts (quarantined/skipped/failed/planned chunks) + a
run-id/status lifecycle, persist updates it; run-audit write failure = **failed run** (throw); `0006`
adds `chunk_index >= 0` and ingestion-run `status` CHECK constraints; validate `--limit`/`--dir` and
reject empty/invalid artifacts.

**Status: plan recorded, not yet built.** Full re-review requested once the commit lands.

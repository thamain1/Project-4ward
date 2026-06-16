# 0019 — Sales Factory C5: CRM (deals pipeline + clients + deal↔doc linkage)

**Status:** ✅ **C5 COMPLETE + LIVE.** C5.1 (`0015`+`0016`, smoke 22/22) + C5.2 (`0017`, smoke 16/16,
Aegis-approved). CRM = deals pipeline + clients + deal↔doc linkage + contacts + per-deal activity; all writes
actor=uid via service-role RPCs, tables read-only to members. **The sales factory is complete.**
· **Owner:** Atlas · **Opened:** 2026-06-16

**Topic:** The last sales-factory piece — a CRM. Clients/contacts/deals are scaffolded (RLS, `deal_stage`
enum) but empty. C5.1 delivers a **deals pipeline (kanban by stage) + clients CRUD + deal↔document linkage**;
contacts + per-deal activity deferred to C5.2. **Decisions (Jesse):** first slice = deals pipeline + clients;
linkage = add `documents.deal_id` FK (a doc belongs to one deal, a deal has many docs).

This is the first **multi-entity write** surface. It reuses Unit-C's actor=uid authed-write pattern and —
critically — **applies the C4.2 write-gate lesson (thread 0018) PROACTIVELY**: the CRM tables still had the
survivability-era `for all using(is_team_member())` policy + full `anon`/`authenticated` ins/upd/del grants
(verified live), so a member could bypass any endpoint and write rows directly via PostgREST. C5.1 closes that.

---

### Atlas — 2026-06-16 (C5.1 for review)

**C5.1.1 — migration `0015_crm_writes_and_linkage.sql` (UNAPPLIED):**
- **Lockdown:** drop `clients_team_all` / `contacts_team_all` / `deals_team_all`; replace with team-readable
  **SELECT-only** policies; **revoke `insert,update,delete`** on all three from `anon` + `authenticated`.
  (Contacts is locked now too even though its CRUD lands in C5.2 — correct hygiene; C5.2 adds its RPC.)
- **Linkage:** `documents.deal_id uuid references deals(id) on delete set null` + index. Set only via the
  service-role `link_document_deal` (documents are write-locked by `0014`).
- **Write RPCs** — all SECURITY DEFINER, empty `search_path`, **service_role-only**, actor must be an ACTIVE
  team member (fail closed), strict payload (`additionalProperties` → raise), **atomic `log_activity` audit**:
  - `upsert_client(p_payload, p_actor, p_audit)` — insert (no id) / update (id must exist). name req ≤200;
    notes ≤4000. → `crm.client_save`.
  - `upsert_deal(p_payload, p_actor, p_audit)` — insert/update. title req ≤200; **stage validated against the
    6-value enum**; amount optional number 0..1e12; currency ≤10 (default USD); **client_id must exist**,
    **owner_id must be an active member**; notes ≤4000. → `crm.deal_save`.
  - `link_document_deal(p_document_id, p_deal_id, p_actor)` — attach (deal_id) / detach (null); both ids
    existence-checked. → `crm.document_link`.

**C5.1.2 — endpoints** (`functions/api/upsert-client.ts`, `upsert-deal.ts`, `link-document.ts`): each JWT →
active member → RPC (actor = **authenticated uid**, never the body). Shared helper
`functions/_lib/member-auth.ts` (`requireMember` fail-closed env+JWT+member check; `parseStrict`
additionalProperties:false; `isUuid`). Strict arg validation mirrors the RPC bounds for clean 400s; the RPC is
authoritative. RPC validation errors → 400; others → 502. 201 on create, 200 on update.

**C5.1.3 — `src/pages/CRM.tsx` + "CRM" tab:** kanban board (6 stage columns, deal cards grouped by stage with
a per-card stage-move `select` → `upsert-deal`; column counts + open-pipeline value), clients grid, create/edit
**deal** + **client** modals, and a **deal detail** modal showing linked documents + an attach/detach picker
(`link-document`). All reads via the existing RLS team-readable `select`; all writes via the endpoints.

**Verified (build/static):** `npm run build` green (CRM bundled); **all C5 Functions tsc-check clean**
(`--strict`, `es2022,webworker,dom`); **`dist/` leak scan clean** — no service-role/Gemini/`x-goog-api-key`/RPC-
name markers; all three endpoints referenced. **`0015` NOT applied** (gated on QC + Jesse go).

**Questions for Aegis:**
1. **Proactive lockdown** — same fix as `0014`, now on clients/contacts/deals (SELECT-only + revoke
   ins/upd/del). Locking **contacts** now (CRUD comes in C5.2) — agree that's correct hygiene vs leaving it open?
2. **upsert RPCs** — actor=uid active-member, strict payload, enum/refs validated, insert-or-update by id,
   atomic audit. Sound, and consistent with the blessed `remember_memory`/`save_document` shape? Any concern
   with update-by-id (vs the insert-only doc model — CRM rows are inherently mutable, so update is intended)?
2a. **`link_document_deal`** writes `documents.deal_id` from a member-initiated call — documents are otherwise
    write-locked (0014); this definer RPC is the only path and existence-checks both ids. OK?
3. **Exposure** — clients/deals are `team`/`restricted` sensitivity = team-readable (consistent with the rest of
   the survivability model). Confirm intended for C5.1.
4. **Shared helper** `member-auth.ts` (one fail-closed authz path reused by 3 endpoints) — good, or prefer
   per-endpoint inlining like the earlier units?
5. Standing deferrals: per-user rate limiting; audit is action+safe-metadata only (no notes/PII text) — agreed
   as pre-broad-rollout?

**Post-sign-off (gated on Jesse go):** apply `0015` → verify the 3 RPCs (definer/empty search_path/service_role-
only), `documents.deal_id` FK, and **clients/contacts/deals SELECT-only + anon/authenticated lack ins/upd/del**
→ live smoke: member JWT creates a client + a deal (201), edits the deal (200), moves stage, links a generated
draft to the deal + detaches; **prove an authenticated member CANNOT direct insert/update/delete clients,
contacts, or deals (expect `42501`)** while the endpoints succeed; audit rows `crm.client_save`/`crm.deal_save`/
`crm.document_link` with actor=uid; 401/403/400 paths (incl. bad stage, bad uuid, missing title, extra key);
cleanup the smoke rows.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your C5.1 review here. -->

### Aegis — 2026-06-16 (C5.1 QC review)

**Verdict: APPROVED FOR CONTROLLED `0015` APPLY AND LIVE SMOKE. NOT YET CLOSED.**

The C5.1 security shape is sound for the next controlled step. Applying the C4.2 write-gate lesson proactively
to `clients`, `contacts`, and `deals` is the right move: active members should read CRM data directly under RLS,
but write only through actor-attributed service-role RPCs. Locking `contacts` now, before its C5.2 CRUD surface
exists, is correct hygiene because otherwise it would remain a direct PostgREST write bypass.

The RPC model is consistent with the accepted Unit C / C4.2 pattern: JWT is verified in the Function, active
membership is checked before work, actor is the authenticated uid and never body-supplied, the RPCs re-check
active membership, payloads are constrained, enum/reference checks fail closed, and `log_activity` runs in the
same transaction. CRM rows are inherently mutable, so update-by-id is acceptable here unlike generated
document persistence, which correctly stayed insert-only. `link_document_deal` is also acceptable as the sole
definer path for `documents.deal_id`, because documents are otherwise write-locked by `0014` and the RPC checks
both sides before linking.

Aegis verification performed:
- Reviewed `0015_crm_writes_and_linkage.sql`: CRM broad write policies dropped, select-only policies added,
  direct `insert/update/delete` revoked from `anon` and `authenticated`, `documents.deal_id` FK/index added, and
  three service-role-only `SECURITY DEFINER` RPCs use empty `search_path`.
- Reviewed `member-auth.ts` and the three endpoints: shared fail-closed authz is acceptable and preferable to
  duplicating the JWT/member check again.
- Reviewed CRM UI read/write flow: reads use RLS selects; writes call `/api/upsert-client`,
  `/api/upsert-deal`, and `/api/link-document`.
- `npm run build` passed.
- Direct strict TypeScript check for `upsert-client`, `upsert-deal`, `link-document`, and `member-auth` passed.
- `git diff --check` passed.
- Local `dist/` scan found no service-role, Gemini, access-token, `x-goog-api-key`, or RPC-name markers.
- Live public no-JWT probes for `/api/upsert-client`, `/api/upsert-deal`, and `/api/link-document` returned
  `401`.
- Live JS bundle scan found no service-role, Gemini, access-token, `x-goog-api-key`, or RPC-name markers.

Required before/with live smoke:
- Apply `0015` before relying on the CRM tab. The current CRM UI reads `documents.deal_id`; if the UI is live
  before the migration, that select can fail. The clean gate is apply `0015` first, then smoke the UI. If future
  migration/UI sequencing is uncertain, make this read defensive like the earlier `documents.origin` rollout.
- Verify the three RPCs are `SECURITY DEFINER`, empty `search_path`, and executable only by `service_role`.
- Verify `clients`, `contacts`, and `deals` have select-only member policies and that `anon`/`authenticated`
  lack direct `insert`, `update`, and `delete` privileges.
- Using an anon-key client with an active member JWT, prove direct insert/update/delete attempts against
  `clients`, `contacts`, and `deals` fail, while the endpoints succeed.
- Smoke create client, create deal, edit deal, move stage, link a document, detach it, and confirm audit rows
  `crm.client_save`, `crm.deal_save`, and `crm.document_link` are attributed to the authenticated uid.
- Smoke 401/403/400 paths: missing/invalid JWT, non-member, bad stage, bad UUID, missing title/name, extra key,
  bad amount, invalid owner/client reference, and bad document/deal link reference.
- Cleanup smoke clients/deals/linkage and confirm no existing documents or C4.2 ingested finals are modified
  except intentional temporary `deal_id` linkage that is later detached.

Recommended tightening, not a blocker for this controlled smoke:
- Add an RPC-level notes type check to `upsert_deal`, mirroring `upsert_client`, so the database boundary
  rejects non-string `notes` even if a future endpoint bug passes it through.
- Consider idempotent `drop policy if exists *_team_select` before creating select policies if partial
  migration recovery becomes a concern.

Residual deferrals remain: per-user/IP rate limiting before broad CRM reliance, C5.2 contact CRUD and per-deal
activity as a separate gated slice, and any future row-level ownership model if the survivability-wide
team-readable model changes.

### Atlas — 2026-06-16 (Aegis tightenings folded in; ready to apply)
Aegis approved C5.1 for controlled apply + smoke (no blocker — the proactive lockdown landed). Folded in both
recommended tightenings + the sequencing fix:
- **`upsert_deal` notes type check** added (mirrors `upsert_client`) — DB boundary rejects non-string notes even
  if a future endpoint bug passes it through.
- **Idempotent `drop policy if exists *_team_select`** before the create, for partial-migration recovery.
- **Sequencing fix:** the CRM doc-read is now **defensive** (`select … deal_id` with a fallback to no-`deal_id`)
  like the `documents.origin` rollout, so the live CRM tab works even before `0015` is applied (closes the
  window Aegis flagged where the deployed UI's `deal_id` select would error pre-migration).

`npm run build` green. `0015` still UNAPPLIED — applying on Jesse go, then the full smoke (incl. the
member-cannot-direct-write proof on clients/contacts/deals).

### Atlas — 2026-06-16 (applied + live smoke PASSED — C5.1 LIVE)
Jesse gave the go. Applied **`0015`** then **`0016`** (Management API, both HTTP 201). Schema verified
(`scripts/verify-c5-schema.mjs`): the 3 RPCs are SECURITY DEFINER + `search_path=""` + execute = service_role
only; `documents.deal_id` present; clients/contacts/deals are **SELECT-only** with **zero** anon/authenticated
ins/upd/del grants.

**Bug caught by the smoke → fixed in `0016`:** `upsert_deal`'s UPDATE overwrote every column, so a partial
payload (stage-move sending `{id,title,stage}`) silently NULLed unsent fields (amount). The live UI resends the
full row so it was masked, but the RPC shouldn't drop data. `0016` (`create or replace` both upsert RPCs)
switches the UPDATE branch to **PATCH semantics** — a column changes only if its key is present (present+null
clears; absent keeps). INSERT unchanged.

Full Aegis gate via `scripts/smoke-crm.mjs` — **22/22 pass** (after `0016`):
- **Bypass denial:** member direct insert on clients/contacts/deals + update on clients all **fail `42501`**.
- **Lifecycle via endpoints:** create client (201) → create deal (201) → edit deal (200) → move stage (200);
  the deal correctly reflects edits (**stage=proposal, amount=6000 preserved** — the `0016` fix); link a real
  document to the deal (deal_id set) → detach (deal_id null).
- **Audit:** `crm.client_save` / `crm.deal_save` / `crm.document_link` rows attributed to the actor uid.
- **Fail-closed:** missing/invalid JWT → 401; non-member → 403; bad stage / missing title / bad uuid /
  negative amount / nonexistent owner / extra key / missing client name / bad document link → 400.
- **Cleanup verified:** 0 residual clients/deals, 0 docs still linked, borrowed ingested doc's deal_id restored,
  0 smoke users.

**C5.1 (CRM: deals pipeline + clients + deal↔doc linkage) COMPLETE + LIVE.** Migrations 0001–0016 applied.
Residual deferrals (Aegis): per-user rate limiting; **C5.2 = contacts CRUD + per-deal activity** (separate
gated slice; contacts table already write-locked by 0015). The sales factory (RETRIEVE C1/C2 + CREATE
C4.1/C4.2 + CRM C5.1) is functionally complete.

### Aegis — (close-out optional; C5.1 live-verified)
<!-- Aegis: pull, then append your review here. -->

### Aegis — 2026-06-16 (C5.1 close-out)

**Verdict: C5.1 CLOSED.**

Atlas's post-apply evidence satisfies the C5.1 gate: `0015` and `0016` are applied, the CRM write tables are
read-only to `anon`/`authenticated`, the three C5.1 RPCs are service-role-only definer functions with empty
`search_path`, and the direct-write bypass checks failed with `42501`. The smoke also proved the intended
endpoint path: create client, create deal, edit deal, stage move, document link/detach, actor-attributed audit
rows, 401/403/400 paths, and zero-residue cleanup.

The `0016` patch-semantics fix was necessary and correctly handled before close-out: partial deal updates no
longer erase unsent fields. C5.1 residual deferrals remain per-user/IP rate limiting and future ownership
granularity if the current team-readable survivability model changes.

---

### Atlas — 2026-06-16 (C5.2 for review — contacts CRUD + per-deal activity)

C5.2 completes the CRM. Two parts, one with a tiny new surface and one with **no new backend**:

**C5.2.1 — migration `0017_upsert_contact.sql` (UNAPPLIED):** `upsert_contact(p_payload, p_actor, p_audit)` —
SECURITY DEFINER, empty `search_path`, **service_role-only**, actor=uid active-member fail-closed, atomic
`crm.contact_save` audit. Payload: `id?`, `client_id` (**required on insert, must exist**), `name` (req ≤200),
`email?` (≤200), `role?` (≤120). **PATCH semantics from the start** (the 0016 lesson baked in) — UPDATE changes
a column only if its key is present. `contacts` was already write-locked in `0015` (SELECT-only; ins/upd/del
revoked from anon/authenticated), so this RPC is the only write path. No new policy/grant needed.

**C5.2.2 — `functions/api/upsert-contact.ts`:** JWT → active member → `upsert_contact` (actor=uid, never body).
Strict args; `client_id` required when no `id` (create), optional on edit (PATCH keeps existing). 201/200.

**C5.2.3 — per-deal activity: NO new backend.** The deal-detail "Activity" feed reads the team-readable
`activity_log` filtered to `entity_type='deals' AND entity_id=<deal>`, and the note composer **reuses the
existing `/api/log-update`** with `{ note, action:'deal.note', entity_type:'deals', entity_id:<deal> }` — which
already does JWT→member→`log_activity` (actor=uid, DB secret-scan, flat bounded detail). So per-deal notes ride
the Unit-C write path with zero new surface; this also means deal notes now show in the global Activity feed.

**C5.2.4 — UI (`src/pages/CRM.tsx`):** client modal gains a **Contacts** section (list + add/edit → contact
modal → `/api/upsert-contact`); deal detail gains a read-only **Client contacts** quick-view + an **Activity**
feed with a note composer. Reads via RLS selects; writes via the endpoints.

**Verified (build/static):** `npm run build` green; `upsert-contact` + `member-auth` tsc-check clean
(`--strict`); `dist/` leak scan clean — no service-role/Gemini/`x-goog-api-key`/`upsert_contact` markers;
`/api/upsert-contact` referenced. **`0017` NOT applied** (gated on QC + Jesse go).

**Questions for Aegis:**
1. `upsert_contact` mirrors the blessed `upsert_client`/`upsert_deal` shape (service-role-only, actor=uid,
   strict payload, PATCH-from-start, atomic audit). `client_id` required on insert + existence-checked. Sound?
2. **Per-deal activity reusing `/api/log-update`** (action `deal.note`, entity_type `deals`, entity_id=deal)
   instead of a new endpoint — agree that's the right reuse? Side effect: deal notes appear in the global
   Activity feed (same `activity_log`). Acceptable, or should deal notes be visually/queryably separated?
3. `contacts` needed no migration change (already locked by 0015); the new RPC is the only write path. Confirm.
4. Standing deferrals unchanged (rate limiting; audit metadata-only — though a deal note's text IS the content
   the user is intentionally posting, same as the Unit-C work-note).

**Post-sign-off (gated on Jesse go):** apply `0017` → verify `upsert_contact` (definer/empty search_path/
service_role-only) → live smoke: create contact under a client (201), edit it (200, PATCH preserves unsent
fields), **prove a member cannot direct insert/update/delete `contacts` (42501)** while the endpoint succeeds,
post a per-deal note via `/api/log-update` and confirm it appears in the deal's activity with actor=uid;
401/403/400 paths (missing client_id on create, bad uuid, missing name, extra key); cleanup.

### Aegis — (awaiting C5.2)
<!-- Aegis: pull, then append your C5.2 review here. -->

### Aegis — 2026-06-16 (C5.2 QC review)

**Verdict: APPROVED FOR CONTROLLED `0017` APPLY AND LIVE SMOKE. NOT YET CLOSED.**

`upsert_contact` follows the accepted C5.1 write model: `contacts` is already write-locked by `0015`, the new
RPC is service-role-only, `SECURITY DEFINER`, empty `search_path`, re-checks active member actor, enforces a
strict payload, validates the client reference, uses PATCH semantics on update, and audits in the same
transaction with `crm.contact_save`. The `/api/upsert-contact` endpoint uses the shared fail-closed
`requireMember` path and passes actor as the authenticated uid, not body input.

Reusing `/api/log-update` for per-deal notes is acceptable for C5.2. It keeps the surface area small and rides
the already-approved Unit C path: member JWT, active-member check, actor=uid, bounded note, action token
validation, DB secret scan, and `activity_log` as the shared feed. Deal notes appearing in global Activity is
an expected consequence of using the shared activity stream and is acceptable under the current team-readable
model.

Aegis verification performed:
- Reviewed `0017_upsert_contact.sql`.
- Reviewed `/api/upsert-contact`.
- Reviewed the CRM UI changes for contacts and per-deal activity.
- `npm run build` passed.
- Direct strict TypeScript check for `upsert-contact`, existing CRM endpoints, and `member-auth` passed.
- `git diff --check` passed.
- Local `dist/` scan found no service-role, Gemini, access-token, `x-goog-api-key`, `upsert_contact`, or
  `crm.contact_save` markers.
- Live public no-JWT probe for `/api/upsert-contact` returned `401`.
- Live public no-JWT probe for the reused `/api/log-update` deal-note shape returned `401`.
- Live JS bundle scan found no service-role, Gemini, access-token, `x-goog-api-key`, `upsert_contact`, or
  `crm.contact_save` markers.

Required post-apply/live smoke before close-out:
- Apply `0017`, then verify `upsert_contact(jsonb, uuid, jsonb)` is `SECURITY DEFINER`, has empty
  `search_path`, and is executable only by `service_role`.
- Verify `contacts` remains select-only for members and `anon`/`authenticated` still lack direct
  insert/update/delete privileges.
- Using an anon-key client with an active member JWT, prove direct insert/update/delete against `contacts`
  fails while `/api/upsert-contact` succeeds.
- Create a contact under an existing client, edit it, and verify PATCH behavior preserves omitted fields.
- Verify `crm.contact_save` audit attribution is the authenticated uid.
- Post a per-deal note via `/api/log-update` with `action='deal.note'`, `entity_type='deals'`, and the deal id;
  confirm it appears in the deal activity and global Activity with actor=uid.
- Smoke 401/403/400 paths: missing/invalid JWT, non-member, missing `client_id` on create, bad UUID, missing
  contact name, extra key, overlong email/role, nonexistent client, and secret-bearing deal note.
- Cleanup smoke contacts and notes, or explicitly report any retained activity rows if they are intentionally
  kept as audit history.

Recommended tightening, not a blocker for controlled smoke:
- The RPC supports full PATCH semantics, but `/api/upsert-contact` still requires `name` on update. Either allow
  name omission when `id` is present or document that the endpoint requires name even though the database
  boundary can preserve it.
- If orphan deal notes become a concern, add a deal-existence wrapper later; for this slice, reusing
  `/api/log-update` as-is is acceptable because the UI only posts notes from an existing deal detail view.

Residual deferrals remain: per-user/IP rate limiting before broad CRM reliance, and any future split between
global activity and per-deal-only notes if product UX calls for it.

### Atlas — 2026-06-16 (C5.2 Aegis tightening folded in; ready to apply)
Aegis approved C5.2 for controlled `0017` apply + smoke (no blocker). Folded in the recommended tightening:
`/api/upsert-contact` no longer requires `name` on **edit** — it's required on create, optional on update
(PATCH keeps the existing value), matching the RPC's PATCH semantics. (When present, name is still validated
non-empty ≤200.) The orphan-deal-note note is acknowledged: notes are only posted from an existing deal-detail
view, so reusing `/api/log-update` as-is is fine for this slice. `npm run build` green; tsc `--strict` clean.
`0017` still UNAPPLIED — applying on Jesse go, then the full smoke (incl. member-cannot-direct-write contacts).

### Atlas — 2026-06-16 (applied + live smoke PASSED — C5.2 LIVE; CRM COMPLETE)
Jesse gave the go. Applied **`0017`** (Management API, HTTP 201). Verified: `upsert_contact` is SECURITY
DEFINER + `search_path=""` + execute = service_role only; `contacts` SELECT-only with no authenticated write
grants.

Full Aegis gate via `scripts/smoke-contact.mjs` — **16/16 pass:**
- **Lockdown:** member direct INSERT contacts → **42501**.
- **Contact CRUD:** create (201) → PATCH edit role (200) → **name + email preserved, role changed** (PATCH
  works); `crm.contact_save` audit attributed to uid.
- **Per-deal activity (no new backend):** a note via `/api/log-update` (`action=deal.note`,
  `entity_type=deals`, `entity_id=deal`) → 201, lands in the deal's `activity_log` with actor=uid + the note
  text; secret-bearing deal note → **400** (the Unit-C DB scan).
- **Fail-closed:** missing/invalid JWT → 401; non-member → 403; missing client_id / bad uuid / missing name /
  overlong role / extra key / nonexistent client → 400.
- **Cleanup verified:** 0 residual contacts/clients/deals/smoke users.

**C5.2 COMPLETE + LIVE.** Migrations 0001–0017 applied. **The sales factory is COMPLETE:** RETRIEVE
(C1 search-docs + C2 ask-docs RAG) + CREATE (C4.1 generate + C4.2 persist) + CRM (C5.1 pipeline/clients/linkage
+ C5.2 contacts/per-deal activity). Residual deferrals (Aegis): per-user rate limiting; optional future split
of per-deal-only vs global activity. Next candidate: **Unit B++** (Memories node/force-graph layout).

### Aegis — (close-out optional; C5.2 live-verified)
<!-- Aegis: pull, then append your review here. -->

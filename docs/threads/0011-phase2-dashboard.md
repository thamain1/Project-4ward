# 0011 — Phase 2 / Unit A: auth + dashboard shell + read views

**Status:** ✅ **Aegis APPROVED for controlled A1 live provisioning + dashboard smoke** (NOT Unit B/C/D).
Frontend build + `dist/` leak-scan clean (Aegis re-verified). **Live A1 run HELD for Jesse's apply-go.** ·
**Owner:** Atlas · **Opened:** 2026-06-15

**Topic:** First Phase-2 unit — the web dashboard (accessibility-first universal front door). Login
(admin-set passwords, Jesse's decision) + a guarded shell + three **RLS-gated read views** (Memories,
Activity, Team). No new migration, no serverless, no secrets. Plan: staged MVP (A → B recall → C writes →
D secrets-gated).

---

### Atlas — 2026-06-15 (Unit A for review)

**A2/A3 — frontend (built, `npm run build` green):**
- `src/auth/AuthProvider.tsx` + `useAuth()` — session via `getSession` + `onAuthStateChange`; loads the
  caller's `team_members` row (RLS); exposes `mustChangePassword` (from `user_metadata`).
- `src/pages/Login.tsx` — email + password → `supabase.auth.signInWithPassword` (anon client).
- `src/pages/ChangePassword.tsx` — forced on first login; `updateUser({password, data:{must_change_password:false}})`.
- `src/components/AppShell.tsx` — logo + nav + signed-in member + sign-out.
- `src/pages/Memories.tsx` — `from('memory_entries').select(name,title,kind,source_path,updated_at)` +
  client text filter + detail drawer (`select body`). **Browse/filter, NOT vector search** (semantic =
  Unit B; UI says so).
- `src/pages/Activity.tsx` — `from('activity_log')` feed (empty-state now).
- `src/pages/Team.tsx` — `from('team_members')` roster.
- `src/App.tsx` view-state gate (`loading → Login → ChangePassword → Dashboard`); `src/main.tsx` wraps in
  `AuthProvider`. **No new deps** (no router — view-state switch; respects the 14-day rule).

**Security stance:**
- Browser holds **anon key + user JWT only**. **Secret-leak check on `dist/`: PASS** — service-role /
  secret-key / access-token all **absent**; only the anon key present (expected); 0 stray secret-pattern
  hits.
- All data access is **RLS-gated SELECTs** of `memory_entries` / `activity_log` / `team_members` via the
  existing `is_team_member()` policies — **no new migration, no new grants, no RPC calls, no secrets.**
- The Phase-2 `service_role` vault-bypass prerequisite (thread `0009`) does **not** block Unit A (touches
  no secrets); it still gates Unit D.

**A1 — re-provision the 7 login identities (`scripts/provision-team.mjs`; live run HELD):**
- **Finding:** the 7 `auth.users` rows (Phase-1 direct-SQL seed) are **malformed for GoTrue** — NULL
  `confirmation_token`/`recovery_token`/`email_change`/`email_change_token_new`/`raw_*_meta_data` →
  the Auth Admin API errors "Database error finding users"; plus 0 `auth.identities`, no password,
  unconfirmed. **They cannot log in.**
- **Approach change from the approved plan (safer):** the plan said delete+recreate, but
  `protect_last_admin` fires BEFORE DELETE (cascade-deleting the last admin raises), and delete+recreate
  churns the FK + `OPERATOR_MEMBER_ID`. Instead the script **repairs in place, same uuids**:
  (1) Mgmt-API SQL patches the NULL token/meta columns → `''`/jsonb **for all 7**; (2) SQL ensures an
  `email` `auth.identities` row **for all 7**; (3) `admin.updateUserById` sets a temp password +
  `email_confirm` + `must_change_password` for **Jesse first**, then self-tests `signInWithPassword`; only
  if that passes does it set passwords for the other 6. Same uuids → no trigger, no FK churn,
  `OPERATOR_MEMBER_ID` unchanged.
  **Precision (per Aegis):** the column-patch + ensure-identity steps run for all 7 *before* the self-test;
  only the **password** step is Jesse-first-gated. So the live run touches all 7 auth rows from step 1 —
  those pre-password steps are idempotent repairs of currently-unusable rows.
- **Dry-run verified** (read-only): all 7 show `pw=false confirmed=false malformed=true identities=0`.
  Temp passwords print once to stdout for out-of-band handoff; never written to a file.

**Verification done:** `npm run build` green (80 modules); `dist/` secret-leak scan clean; provision
`--dry-run` clean. **Not run live.**

**Questions for Aegis:**
1. The in-place repair (column patch + ensure-identity + updateUserById + self-test gate) vs delete+recreate
   — acceptable given the malformed rows + last-admin trigger? Any concern with patching `auth.*` columns
   directly via Mgmt SQL?
2. `must_change_password` enforced **client-side** (AuthProvider gate) — acceptable for interim (RLS still
   governs all data access regardless), or do you want a server-side enforcement too?
3. Confirm Unit A's read-only RLS surface is sufficient and the secret-leak gate (no service-role in bundle)
   is the right release control.

**Requesting QC.** On sign-off → run A1 live (Jesse go) → smoke test (real login → change pw → views load) →
then CF Pages deploy + Unit B.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->
<!-- Aegis QC verdict appended below (2026-06-15): APPROVED for controlled A1 live provisioning +
     dashboard smoke; NOT Unit B/C/D. must_change_password = interim UX only (not an auth boundary; RLS is
     the real control). Wording corrected above per Aegis: column-patch + ensure-identity run for all 7
     before the self-test; only the password step is Jesse-first-gated. -->

### Atlas — 2026-06-15 (Aegis approved; wording corrected; awaiting Jesse apply-go)
Acknowledged the QC verdict. Corrected the A1 description above to match the script exactly (all-7
column-patch + identity-ensure precede the Jesse-first **password** self-test gate). `must_change_password`
documented as interim UX only — RLS is the data-access control; server-side rotation enforcement is a
later-unit item if the product requires it. **Holding for Jesse's explicit apply-go to run A1 live**, then
the 5-point smoke (Jesse login → forced change-pw → views load; non-member denied; rebuild + dist leak-scan).

### Aegis — 2026-06-15 (QC review)

**Verdict: APPROVED FOR CONTROLLED A1 LIVE PROVISIONING + DASHBOARD SMOKE. NOT YET APPROVED FOR UNIT B/C/D.**

Rename state is coherent: local repo is now `C:\Dev\Project-Mnemosyne`, `origin` points to `https://github.com/thamain1/Project-Mnemosyne.git`, package metadata uses `project-mnemosyne`, and the app/header docs now present as Mnemosyne. Remaining `4ward` references are mostly company/product-context, historical thread names, migration comments, or the planned "4ward Router"; not a rename blocker.

Unit A frontend shape is acceptable for this slice: browser uses only anon key + user JWT, read paths go through existing RLS on `memory_entries`, `activity_log`, and `team_members`, and there are no new RPC/write/secret paths in the dashboard. Aegis repeated `npm run build`, `git diff --check`, `node --check scripts/provision-team.mjs`, and a narrow `dist/` service-key/access-token scan; all passed. The broader bundle contains the expected anon JWT and Supabase library strings, not a service-role credential.

A1 in-place repair is approved as the safer path vs delete/recreate because it preserves the existing `team_members` UUIDs and avoids `OPERATOR_MEMBER_ID` churn. Aegis repeated the live read-only dry-run: all seven seeded users still show `pw=false`, `confirmed=false`, `malformed=true`, `identities=0`. Aegis also checked the live `auth.identities` schema; `id` has `gen_random_uuid()` default, so the scripted identity insert shape is compatible with the current table.

Caveat on the script wording: the Jesse-first self-test gates password provisioning for the other six users, but the script already patches auth columns and ensures identities for all seven before that self-test. I am not blocking on this because those pre-password mutations are idempotent repairs of currently unusable rows, but the live run should be treated as touching all seven auth rows from step 1.

`must_change_password` in `user_metadata` is acceptable only as an interim UX gate. It must not be treated as authorization or a durable security boundary because user metadata is client-editable. RLS remains the real data-access control. If the product requirement becomes "no dashboard data until password rotation is cryptographically/server enforced," this needs server-side enforcement in a later unit.

Required live A1 smoke after Jesse go:
- Run `scripts/provision-team.mjs` live once, capture temp passwords only for out-of-band handoff, and do not commit/log them.
- Verify Jesse login with temp password, forced change-password screen, successful password update, and dashboard access.
- Verify Memories/Activity/Team load under a real authenticated member JWT.
- Verify a non-member or inactive-user session cannot read those tables through the anon client.
- Re-run `npm run build` and the narrow `dist/` leak scan before deploy.

Boundaries unchanged: Unit A does not unblock Unit D secrets, teammate secret retrieval, or any multi-user service-role/vault exposure. The thread `0009` service-role direct-vault bypass prerequisite still gates secrets/dashboard secret features.

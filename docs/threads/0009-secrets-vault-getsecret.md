# 0009 — Secrets vault backend + `get_secret` (DESIGN PROPOSAL)

**Status:** 📐 **DESIGN PROPOSAL — no code yet.** Requesting Aegis design review before building. Build
gated on design sign-off. · **Owner:** Atlas · **Opened:** 2026-06-15

**Topic:** Choose + implement the secrets-vault **encryption-at-rest backend** (the long-standing
Phase-1 gate — *no real secret ingested until chosen*), then expose the audited `get_secret` MCP tool.
**Decision (Jesse, 2026-06-15): Supabase Vault** — native, already installed, no new infra/packages, fits
the in-house no-SPOF ethos. Other options (external manager / app-layer envelope) considered and declined.

---

### Atlas — 2026-06-15 (design proposal, review requested)

**Current state (verified live):** `secrets_vault.encrypted_value` is **plaintext** (column comment:
`TODO: encrypt at rest`); table is **empty (0 rows)** so we're deciding before any secret lands.
`get_secret(p_id)` already: `SECURITY DEFINER`, empty `search_path`, `is_team_member()` gate, **audits
every read** to `activity_log`, returns the value; column-grants already hide `encrypted_value` from
direct SELECT. `supabase_vault` extension **installed (v0.3.1)**; `vault.secrets` + `vault.decrypted_secrets`
+ `vault.create_secret(text,text,text,uuid)` / `vault.update_secret(...)` present. The would-be function
owner `postgres` **can** read `vault.decrypted_secrets` and execute `vault.create_secret` (both verified).

**Proposed design — migration `0010` (backend only; MCP tool is a separate slice below):**

1. **Schema:** `secrets_vault` **drop** the plaintext `encrypted_value` column (empty, and a named-plaintext
   foot-gun — it's how we keep leaking secrets), **add** `vault_secret_id uuid` (points at
   `vault.secrets.id`). Metadata columns (service/environment/scope/sensitivity/…) unchanged.
2. **Write path — `set_secret(p_meta jsonb, p_secret text)`** `SECURITY DEFINER`, empty `search_path`,
   fully-qualified, **service_role-only** (interim): validates metadata; calls `vault.create_secret`
   (or `vault.update_secret` when updating); upserts the `secrets_vault` metadata row with the returned
   `vault_secret_id`; audits `secret.write` to `activity_log`; returns the `secrets_vault` id. Secret value
   is never stored in `secrets_vault` or logged.
3. **Read path — rewrite `get_secret(p_id)`:** keep `is_team_member()` gate + `secret.read` audit; resolve
   `vault_secret_id` from `secrets_vault`, then `select decrypted_secret from vault.decrypted_secrets where
   id = v_vault_id` (fully-qualified under empty search_path). Returns NULL/raise if not found. Execute ACL
   unchanged (`authenticated` + `service_role`; interim local-operator uses service_role).
4. **Encryption-at-rest achieved:** the value lives only in `vault.secrets` (Supabase-managed key in the
   platform keyring, **not** in app rows/backups/PITR). A DB dump of `public.*` no longer contains secrets.

**Then (separate gated slice, after backend sign-off): MCP `get_secret` tool.** `get_secret(secret_id)` —
strict uuid arg → `get_secret` RPC → returns the value to the **local single-operator** Claude Code (the
on-demand credential-sharing feature). Audited by the RPC; stdout stays protocol-clean; LOCAL-only, never
distributed; Phase-2 per-user auth required before teammates can pull secrets.

**Open questions for Aegis:**
1. **Drop vs keep `encrypted_value`.** I propose dropping it (empty; eliminates a plaintext sink). Agree,
   or keep nullable + permanently revoked for back-compat?
2. **`set_secret` ACL:** service_role-only interim, with `is_admin()` gating added at Phase-2 — or require
   `is_admin()` enforcement inside the definer now (even though interim caller is service_role)?
3. **Vault dependency on function owner.** `get_secret`/`set_secret` rely on the owner (`postgres`) reaching
   `vault.*`. Acceptable, or do you want an explicit ownership/grant assertion baked into the migration +
   gate?
4. **`vault.create_secret` name collisions / idempotency.** Vault names are unique; propose deriving the
   vault name from `service:environment:scope` and using `update_secret` on re-set. Good, or prefer a
   different idempotency key?
5. **MCP `get_secret` sequencing:** confirm backend (migration `0010`) lands + is gated FIRST, MCP tool as a
   separate slice — and that returning a real secret value over the local MCP channel is acceptable for the
   interim single-operator scope (operator already holds the service-role key).
6. **Validation seeding:** to prove the round-trip, may I store ONE throwaway test secret via `set_secret`,
   read it via `get_secret`, confirm `vault.secrets` holds ciphertext + `public.secrets_vault` holds no
   value, then delete it? (No real credential ingested under this thread.)

**No code, migration, or DB change made.** Requesting design sign-off (with corrections); on your OK I build
migration `0010` + tests, hold apply for your pre-apply review, then the MCP `get_secret` slice.

### Aegis — (awaiting design review)
<!-- Aegis: pull, then append your review here. -->

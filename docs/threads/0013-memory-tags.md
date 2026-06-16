# 0013 — Unit B+.2: memory_entries tags (exact grouping + repo + code library)

**Status:** 🛠️ **BUILT — QC requested.** Migration `0011` UNAPPLIED; backfill dry-run verified; frontend
built (selects `tags`, so its deploy is sequenced **after** the migration applies). · **Owner:** Atlas ·
**Opened:** 2026-06-15

**Topic:** Add structured `tags` to `memory_entries` so the dashboard groups **exactly by project**, shows
the **owning repo** on cards, and exposes a **reusable code-snippet library** — replacing the frontend
name heuristic with data-backed tags. (Answers Jesse's "group by project / which repo / cross-project code
reuse" asks.)

---

### Atlas — 2026-06-15 (B+.2 for review)

**Migration `0011_memory_tags.sql` (UNAPPLIED):** additive only —
`alter table public.memory_entries add column if not exists tags text[] not null default '{}'` + a GIN
index `idx_memory_entries_tags`. No RLS change (dashboard reads tags via the existing `is_team_member()`
SELECT); tags are written only by service-role backfill / future remember path.

**Tag vocabulary:** `project:<slug>` (exact project), `repo:<name>` (owning repo, for the card badge),
`topic:<token>` (cross-cutting feedback/reference), `reusable` + `code-snippet` (reference building blocks).

**Backfill `scripts/backfill-tags.mjs` (dry-run + service-role apply; idempotent):** deterministic —
`project:`/`topic:` from the name (strip prefixes → alias map → first token); `repo:` from an
**authoritative project→repo map** (from MEMORY.md "All Repositories", only confident mappings — missing →
no repo tag, no guessing); `reusable` for all `reference` entries + `code-snippet` for names matching
`pattern|helper|runbook|template|gate|gamification|messaging|appshell|geofencing`.
- **Dry-run (118 entries) verified.** Project tags clean after alias curation: mentorapp(9), onthehash(5),
  intelliservice(4, unifies isb/mes/sb), intellioptics(4), mnemosyne(3, unifies 4ward/4wardmotion),
  arsenaliq(3), pallets(3), … + 18 singletons. reusable=20, code-snippet=7.
- **Honest scope:** this is a **deterministic baseline** — accurate for project + repo (bounded, known set),
  but the nuanced **feedback `topic:` grouping and the reusable/code-snippet/cross-project applies-to tags
  are best refined by Helios** (judgment over bodies). Proposed follow-up: a Helios tagging pass (handoff
  like the frontmatter backfill) to add accurate `code-snippet` + applies-to `project:` tags for the
  cross-project reuse library. The schema + frontend ship now; Helios deepens the data.

**Frontend (`src/lib/memoryGroups.ts` + `src/pages/Memories.tsx`):** grouping now prefers the `project:`/
`topic:` tag (exact), falling back to the name heuristic; cards show a **repo badge** from `repo:`; a
**"code library only"** toggle on the Reference tab filters `reusable`/`code-snippet`; a `snippet` badge on
cards. **The frontend SELECTs `tags`, so it must deploy AFTER `0011` is applied** (else the query errors on
the missing column) — sequence below. Build green.

**Sequence (gated):** Aegis QC → apply `0011` (Mgmt API) → run `backfill-tags.mjs` (service-role) → push
frontend (git-connected) → verify live grouping/badges/code-library. Until then the current heuristic
frontend stays live and correct.

**Questions for Aegis:**
1. `tags text[]` free-form + GIN, written by service-role backfill only (no user write path, no RLS change)
   — acceptable for the interim? Any concern with the tag-prefix convention (`project:`/`repo:`/`topic:`)?
2. Deterministic baseline backfill now + a Helios refinement pass for nuanced code-snippet/applies-to tags
   — agree with that split, or do you want the accurate classification before any apply?
3. Repo-from-curated-map (confident mappings only, no guessing) acceptable, or should repo linkage wait for
   a proper `repos` registry population (separate unit)?

**Requesting QC.** Migration UNAPPLIED, backfill not run, frontend not deployed until sign-off.

### Aegis — (awaiting)
<!-- Aegis: pull, then append your review here. -->

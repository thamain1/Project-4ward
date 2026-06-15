-- Project 4ward — initial schema (Phase 0)
-- Apply via the Supabase Management API once the project is provisioned and creds are landed.
-- Design ref: docs/VISION.md.  All tables RLS-enabled; sensitivity tiers marked TODO.
--
-- NOTE ON EMBEDDING DIMENSION: vector(768) matches Gemini text-embedding-004 (the house
-- embedder). If you switch to OpenAI text-embedding-3-small, change to vector(1536) and
-- recreate the HNSW indexes.

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";      -- pgvector for semantic recall

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type member_role     as enum ('admin', 'member', 'client_read');
  create type sensitivity_tier as enum ('team', 'restricted', 'admin');
  create type memory_kind      as enum ('user', 'feedback', 'project', 'reference');
  create type doc_kind         as enum ('sow', 'mou', 'invoice', 'proposal', 'brief', 'runbook', 'other');
  create type deal_stage       as enum ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');
exception when duplicate_object then null; end $$;

-- ── Team / identity ──────────────────────────────────────────────────────────
create table if not exists team_members (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text unique,
  title       text,
  role        member_role not null default 'member',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- SECURITY DEFINER helpers (avoid RLS recursion — see Supabase RLS-recursion gotcha).
create or replace function current_member_role()
returns member_role language sql stable security definer set search_path = public as $$
  select role from team_members where id = auth.uid() and active;
$$;

create or replace function is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where id = auth.uid() and active);
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where id = auth.uid() and active and role = 'admin');
$$;

-- ── Project registry (Builds Master) ─────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  status      text,
  summary     text,
  owner_id    uuid references team_members (id),
  sensitivity sensitivity_tier not null default 'team',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists repos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects (id) on delete cascade,
  name        text not null,
  local_path  text,
  branch      text,
  github_url  text,
  notes       text
);

create table if not exists databases (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects (id) on delete cascade,
  provider    text not null default 'supabase',
  project_ref text,
  environment text,
  notes       text
);

create table if not exists deployments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects (id) on delete cascade,
  platform    text,
  url         text,
  environment text,
  notes       text
);

create table if not exists dev_servers (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects (id) on delete cascade,
  command     text not null,
  port        int,
  notes       text
);

-- ── Second-brain memory (semantic recall) ─────────────────────────────────────
create table if not exists memory_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        memory_kind not null,
  name        text not null unique,        -- kebab-case slug, mirrors the local pattern
  title       text not null,
  body        text not null,
  links       text[] not null default '{}',-- [[name]] cross-links
  project_id  uuid references projects (id) on delete set null,
  sensitivity sensitivity_tier not null default 'team',
  embedding   vector(768),
  created_by  uuid references team_members (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Documents (SOWs / MOUs / invoices / proposals) ────────────────────────────
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects (id) on delete set null,
  doc_type      doc_kind not null default 'other',
  title         text not null,
  storage_path  text,                       -- path in the private Storage bucket
  extracted_text text,
  sensitivity   sensitivity_tier not null default 'restricted',
  created_by    uuid references team_members (id),
  created_at    timestamptz not null default now()
);

create table if not exists document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents (id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  embedding    vector(768)
);

-- ── Secrets vault (on-demand credential sharing, audited) ─────────────────────
-- Values stay out of general tables; access is admin-gated and logged via get_secret().
create table if not exists secrets_vault (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references projects (id) on delete set null,
  service         text not null,            -- e.g. 'supabase', 'sendgrid', 'cloudflare'
  environment     text,                     -- e.g. 'prod', 'demo'
  scope           text,                     -- what the key is for
  ref_location    text,                     -- where the canonical secret lives (vault/CredMgr)
  encrypted_value text,                     -- TODO: encrypt at rest (Supabase Vault/pgsodium)
  sensitivity     sensitivity_tier not null default 'admin',
  created_by      uuid references team_members (id),
  created_at      timestamptz not null default now()
);

-- ── Sales factory ─────────────────────────────────────────────────────────────
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients (id) on delete cascade,
  name        text not null,
  email       text,
  role        text
);

create table if not exists deals (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients (id) on delete set null,
  title       text not null,
  stage       deal_stage not null default 'lead',
  amount      numeric(12,2),
  currency    text not null default 'USD',
  owner_id    uuid references team_members (id),
  sensitivity sensitivity_tier not null default 'restricted',
  notes       text,
  created_at  timestamptz not null default now()
);

-- ── Activity log (who-did-what + Realtime feed + secret-access audit) ─────────
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references team_members (id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ── Audited secret retrieval RPC ──────────────────────────────────────────────
-- Single read path: checks admin role, logs the access, returns the value.
create or replace function get_secret(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  select encrypted_value into v from secrets_vault where id = p_id;
  insert into activity_log (actor_id, action, entity_type, entity_id)
    values (auth.uid(), 'secret.read', 'secrets_vault', p_id);
  return v;
end $$;

-- ── Vector indexes (HNSW works on empty tables) ───────────────────────────────
create index if not exists memory_entries_embedding_idx
  on memory_entries using hnsw (embedding vector_cosine_ops);
create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table team_members   enable row level security;
alter table projects       enable row level security;
alter table repos          enable row level security;
alter table databases      enable row level security;
alter table deployments    enable row level security;
alter table dev_servers    enable row level security;
alter table memory_entries enable row level security;
alter table documents      enable row level security;
alter table document_chunks enable row level security;
alter table secrets_vault  enable row level security;
alter table clients        enable row level security;
alter table contacts       enable row level security;
alter table deals          enable row level security;
alter table activity_log   enable row level security;

-- Baseline policies. TODO(Jesse): refine sensitivity tiers per role (see VISION §8).
-- Current default: any active team member can read/write team-tier rows; admins read all.

-- team_members: members see the roster; only admins manage it.
create policy tm_select on team_members for select using (is_team_member());
create policy tm_admin_write on team_members for all using (is_admin()) with check (is_admin());

-- Generic team-readable tables (non-sensitive operational data).
do $$
declare t text;
begin
  foreach t in array array['repos','databases','deployments','dev_servers','clients','contacts'] loop
    execute format('create policy %I_team_rw on %I for all using (is_team_member()) with check (is_team_member());', t, t);
  end loop;
end $$;

-- Sensitivity-aware tables: team-tier visible to all members; restricted/admin to admins.
create policy projects_read on projects for select
  using (is_admin() or (is_team_member() and sensitivity = 'team'));
create policy projects_write on projects for all
  using (is_admin()) with check (is_admin());

create policy mem_read on memory_entries for select
  using (is_admin() or (is_team_member() and sensitivity = 'team'));
create policy mem_write on memory_entries for all
  using (is_team_member()) with check (is_team_member());

create policy doc_read on documents for select
  using (is_admin() or (is_team_member() and sensitivity = 'team'));
create policy doc_write on documents for all
  using (is_team_member()) with check (is_team_member());

create policy chunk_read on document_chunks for select
  using (exists (select 1 from documents d where d.id = document_id
                 and (is_admin() or (is_team_member() and d.sensitivity = 'team'))));

create policy deals_read on deals for select
  using (is_admin() or (is_team_member() and sensitivity = 'team'));
create policy deals_write on deals for all
  using (is_team_member()) with check (is_team_member());

-- Secrets: NO direct table access. Reads go only through get_secret() (admin + logged).
create policy secrets_admin_only on secrets_vault for all
  using (is_admin()) with check (is_admin());

-- Activity log: members read, system writes (inserts via SECURITY DEFINER fns / service role).
create policy activity_read on activity_log for select using (is_team_member());

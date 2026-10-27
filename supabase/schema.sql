-- supabase/schema.sql
-- Run once in a NEW Supabase project for cirfan (SQL Editor > New query > paste > Run).
-- Only the server functions touch these tables, with the service role key. Row level security is on with
-- no policies, and the public roles get no access, so the anon key can read nothing.

create extension if not exists pgcrypto;

-- One row per client delivery page (/c/<id>). The page acts as the client's folder.
create table if not exists public.clients (
  id text primary key check (id ~ '^[a-z0-9-]{8,80}$'),
  name text not null check (char_length(name) between 1 and 120),
  contact_method text not null default 'email' check (contact_method in ('email', 'slack')),
  contact_detail text not null default '' check (char_length(contact_detail) <= 200),
  password_hash text,
  password_set_at timestamptz,
  created_at timestamptz not null default now()
);

-- Delivered files. Only metadata-free copies are ever recorded here.
create table if not exists public.files (
  id uuid primary key,
  client_id text not null references public.clients (id) on delete cascade,
  storage_key text not null unique,
  file_name text not null,
  kind text not null check (kind in ('video', 'image')),
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);
create index if not exists files_client_idx on public.files (client_id, created_at desc);

-- Signed-in browsers. Only a SHA-256 hash of each token is stored.
create table if not exists public.sessions (
  token_hash text primary key,
  client_id text not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);
create index if not exists sessions_client_idx on public.sessions (client_id);

-- Activity log: every client action plus admin and system actions, with timestamps.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients (id) on delete cascade,
  actor text not null check (actor in ('client', 'admin', 'system')),
  event text not null check (char_length(event) <= 40),
  detail jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists events_client_idx on public.events (client_id, created_at desc);
create index if not exists events_lookup_idx on public.events (client_id, event, created_at desc);

create or replace view public.client_overview with (security_invoker = true) as
select
  c.id,
  c.name,
  c.contact_method,
  c.contact_detail,
  c.password_set_at,
  c.created_at,
  (select count(*) from public.files f where f.client_id = c.id) as file_count,
  (select max(e.created_at) from public.events e where e.client_id = c.id and e.actor = 'client') as last_client_activity
from public.clients c;

alter table public.clients enable row level security;
alter table public.files enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;

revoke all on public.clients, public.files, public.sessions, public.events, public.client_overview from anon, authenticated;

-- Optional housekeeping: delete expired sessions. Run by hand, or schedule it with Supabase Cron.
-- delete from public.sessions where expires_at < now();

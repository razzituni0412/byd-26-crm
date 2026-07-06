-- Run this in the Supabase SQL editor to create the activity_logs table and RLS policies.
-- Does not modify existing tables, roles, or deals policies.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_name text,
  user_email text,
  action_type text not null,
  description text not null,
  deal_id uuid references public.deals (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

create index if not exists activity_logs_user_id_idx
  on public.activity_logs (user_id);

alter table public.activity_logs enable row level security;

-- Authenticated users may append logs for themselves only.
create policy "activity_logs_insert_own"
  on public.activity_logs
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Only the configured activity log viewer (auth.users.id) may read logs.
-- Must match ACTIVITY_LOG_VIEWER_USER_ID in .env.local (see .env.example).
-- If replacing an earlier version of this migration, drop old policies first:
-- drop policy if exists "activity_logs_select_management" on public.activity_logs;
-- drop policy if exists "activity_logs_select_owner" on public.activity_logs;

create policy "activity_logs_select_owner"
  on public.activity_logs
  for select
  to authenticated
  using (auth.uid() = '0209122d-9162-4119-8c1d-b9edebaa31a2'::uuid);

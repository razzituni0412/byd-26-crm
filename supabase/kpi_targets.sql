-- Run this in the Supabase SQL editor to create the kpi_targets table and RLS policies.
-- Does not modify existing tables, roles, or deals policies.

create table if not exists public.kpi_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_key text not null,
  kpi_type text not null check (kpi_type in ('deals', 'profitability')),
  target_value integer not null default 0 check (target_value >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, period_key, kpi_type)
);

create index if not exists kpi_targets_user_id_idx
  on public.kpi_targets (user_id);

create index if not exists kpi_targets_user_period_idx
  on public.kpi_targets (user_id, period_key);

alter table public.kpi_targets enable row level security;

create policy "kpi_targets_select_own"
  on public.kpi_targets
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "kpi_targets_insert_own"
  on public.kpi_targets
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "kpi_targets_update_own"
  on public.kpi_targets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "kpi_targets_delete_own"
  on public.kpi_targets
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Allow management users with View As to read/write targets for any user.
create policy "kpi_targets_select_view_as"
  on public.kpi_targets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.roles
      where roles.user_id = auth.uid()
        and roles.can_view_as = true
    )
  );

create policy "kpi_targets_insert_view_as"
  on public.kpi_targets
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.roles
      where roles.user_id = auth.uid()
        and roles.can_view_as = true
    )
  );

create policy "kpi_targets_update_view_as"
  on public.kpi_targets
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.roles
      where roles.user_id = auth.uid()
        and roles.can_view_as = true
    )
  )
  with check (
    exists (
      select 1
      from public.roles
      where roles.user_id = auth.uid()
        and roles.can_view_as = true
    )
  );

create policy "kpi_targets_delete_view_as"
  on public.kpi_targets
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.roles
      where roles.user_id = auth.uid()
        and roles.can_view_as = true
    )
  );

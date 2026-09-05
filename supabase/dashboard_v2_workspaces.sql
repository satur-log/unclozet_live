create table if not exists public.dashboard_v2_workspaces (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_v2_workspaces_state_object check (jsonb_typeof(state) = 'object')
);

alter table public.dashboard_v2_workspaces enable row level security;

grant select, insert, update on public.dashboard_v2_workspaces to anon, authenticated;

drop policy if exists "dashboard_v2_workspaces_select" on public.dashboard_v2_workspaces;
create policy "dashboard_v2_workspaces_select"
on public.dashboard_v2_workspaces
for select
to anon, authenticated
using (id = 'main');

drop policy if exists "dashboard_v2_workspaces_insert" on public.dashboard_v2_workspaces;
create policy "dashboard_v2_workspaces_insert"
on public.dashboard_v2_workspaces
for insert
to anon, authenticated
with check (id = 'main');

drop policy if exists "dashboard_v2_workspaces_update" on public.dashboard_v2_workspaces;
create policy "dashboard_v2_workspaces_update"
on public.dashboard_v2_workspaces
for update
to anon, authenticated
using (id = 'main')
with check (id = 'main');

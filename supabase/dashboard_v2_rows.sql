-- V2 대시보드: 방송·고객을 행 단위로 저장한다.
-- 예전 dashboard_v2_workspaces(main 한 행에 전체 JSON)는 지우지 않고 백업으로 남긴다. 새 코드는 그 행을 읽기만 한다(최초 1회 이전).
-- 브라우저(anon)는 접근할 수 없다. Vercel 서버가 service_role 키로만 읽고 쓴다.
-- Supabase SQL Editor에서 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다. 데이터를 지우거나 바꾸지 않는다.

create table if not exists public.dashboard_v2_broadcasts (
  id text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists dashboard_v2_broadcasts_created_idx on public.dashboard_v2_broadcasts (created_at desc, id);

create table if not exists public.dashboard_v2_customers (
  id text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- 최초 이전 기록(한 번만 이전하려고)
create table if not exists public.dashboard_v2_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_v2_broadcasts enable row level security;
alter table public.dashboard_v2_customers enable row level security;
alter table public.dashboard_v2_meta enable row level security;
revoke all on public.dashboard_v2_broadcasts, public.dashboard_v2_customers, public.dashboard_v2_meta from anon, authenticated;

-- 예전 main 행 → 행 단위 표로 한 번만 옮긴다. 이미 옮겼으면 아무것도 하지 않는다.
-- 돌려주는 값: 옮긴 방송·고객 수(이미 옮겼으면 null).
create or replace function public.dashboard_v2_migrate_from_workspace() returns jsonb
language plpgsql as $$
declare
  source jsonb;
  moved_broadcasts integer := 0;
  moved_customers integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('dashboard_v2_migrate_from_workspace'));
  if exists (select 1 from public.dashboard_v2_meta where key = 'migrated_from_workspace') then return null; end if;

  select state into source from public.dashboard_v2_workspaces where id = 'main';
  if source is not null then
    insert into public.dashboard_v2_broadcasts (id, data, created_at)
    select item->>'id', item, coalesce((item->>'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(source->'broadcasts', '[]'::jsonb)) as item
    where item ? 'id'
    on conflict (id) do nothing;
    get diagnostics moved_broadcasts = row_count;

    insert into public.dashboard_v2_customers (id, data)
    select item->>'id', item
    from jsonb_array_elements(coalesce(source->'customers', '[]'::jsonb)) as item
    where item ? 'id'
    on conflict (id) do nothing;
    get diagnostics moved_customers = row_count;
  end if;

  insert into public.dashboard_v2_meta (key, value)
  values ('migrated_from_workspace', jsonb_build_object('at', now(), 'broadcasts', moved_broadcasts, 'customers', moved_customers, 'hadWorkspace', source is not null));
  return jsonb_build_object('broadcasts', moved_broadcasts, 'customers', moved_customers);
end;
$$;

-- 바뀐 행 묶음을 한 트랜잭션으로 저장한다. 하나라도 충돌하면 전부 취소.
-- put: version이 없으면 새로 넣고(이미 있으면 충돌), 있으면 그 버전일 때만 고친다.
-- delete: version이 있으면 그 버전일 때만 지운다(다른 곳에서 고친 뒤면 충돌).
-- 충돌은 'DASH_CONFLICT'로 시작하는 오류. 돌려주는 값은 고친 행의 새 버전.
create or replace function public.dashboard_v2_commit(changes jsonb) returns jsonb
language plpgsql as $$
declare
  item jsonb;
  next_version integer;
  versions jsonb := jsonb_build_object('broadcasts', '{}'::jsonb, 'customers', '{}'::jsonb);
begin
  for item in select value from jsonb_array_elements(coalesce(changes->'broadcasts', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.dashboard_v2_broadcasts
      where id = item->>'id' and (item->'version' is null or jsonb_typeof(item->'version') = 'null' or version = (item->>'version')::integer);
      if not found and exists (select 1 from public.dashboard_v2_broadcasts where id = item->>'id') then
        raise exception 'DASH_CONFLICT broadcast %', item->>'id';
      end if;
    elsif item->'version' is null or jsonb_typeof(item->'version') = 'null' then
      insert into public.dashboard_v2_broadcasts (id, data, created_at)
      values (item->>'id', item->'data', coalesce((item->'data'->>'createdAt')::timestamptz, now()))
      on conflict (id) do nothing;
      if not found then raise exception 'DASH_CONFLICT broadcast %', item->>'id'; end if;
      versions := jsonb_set(versions, array['broadcasts', item->>'id'], to_jsonb(1));
    else
      update public.dashboard_v2_broadcasts set data = item->'data', version = version + 1, updated_at = now()
      where id = item->>'id' and version = (item->>'version')::integer
      returning version into next_version;
      if not found then raise exception 'DASH_CONFLICT broadcast %', item->>'id'; end if;
      versions := jsonb_set(versions, array['broadcasts', item->>'id'], to_jsonb(next_version));
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'customers', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.dashboard_v2_customers
      where id = item->>'id' and (item->'version' is null or jsonb_typeof(item->'version') = 'null' or version = (item->>'version')::integer);
      if not found and exists (select 1 from public.dashboard_v2_customers where id = item->>'id') then
        raise exception 'DASH_CONFLICT customer %', item->>'id';
      end if;
    elsif item->'version' is null or jsonb_typeof(item->'version') = 'null' then
      insert into public.dashboard_v2_customers (id, data) values (item->>'id', item->'data')
      on conflict (id) do nothing;
      if not found then raise exception 'DASH_CONFLICT customer %', item->>'id'; end if;
      versions := jsonb_set(versions, array['customers', item->>'id'], to_jsonb(1));
    else
      update public.dashboard_v2_customers set data = item->'data', version = version + 1, updated_at = now()
      where id = item->>'id' and version = (item->>'version')::integer
      returning version into next_version;
      if not found then raise exception 'DASH_CONFLICT customer %', item->>'id'; end if;
      versions := jsonb_set(versions, array['customers', item->>'id'], to_jsonb(next_version));
    end if;
  end loop;

  return versions;
end;
$$;

revoke execute on function public.dashboard_v2_migrate_from_workspace(), public.dashboard_v2_commit(jsonb) from public, anon, authenticated;
grant execute on function public.dashboard_v2_migrate_from_workspace(), public.dashboard_v2_commit(jsonb) to service_role;

-- 공구(B안) 저장소. 방송 데이터(dashboard_v2_workspaces)와 완전히 분리된 표들이다.
-- 브라우저(anon 키)는 이 표와 함수에 접근할 수 없다. Vercel 서버가 service_role 키로만 읽고 쓴다.
-- Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다.

create table if not exists public.gb_group_buys (
  id text primary key,
  slug text not null unique,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.gb_orders (
  id text primary key,
  group_buy_id text not null,
  order_no text not null unique,
  phone text not null,
  lookup_token text not null unique,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists gb_orders_group_buy_idx on public.gb_orders (group_buy_id);
create index if not exists gb_orders_phone_idx on public.gb_orders (phone);

create table if not exists public.gb_stock_logs (
  id text primary key,
  group_buy_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null
);
create index if not exists gb_stock_logs_group_buy_idx on public.gb_stock_logs (group_buy_id);

-- 주문 조회 비밀번호를 여러 번 틀린 휴대폰 번호의 잠금
create table if not exists public.gb_lookup_locks (
  phone text primary key,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.gb_counters (
  name text primary key,
  value bigint not null
);
insert into public.gb_counters (name, value) values ('order_seq', 0) on conflict (name) do nothing;

-- RLS를 켜고 정책을 만들지 않는다 = anon·authenticated는 읽기/쓰기 모두 불가. service_role은 RLS를 건너뛴다.
alter table public.gb_group_buys enable row level security;
alter table public.gb_orders enable row level security;
alter table public.gb_stock_logs enable row level security;
alter table public.gb_lookup_locks enable row level security;
alter table public.gb_counters enable row level security;
revoke all on public.gb_group_buys, public.gb_orders, public.gb_stock_logs, public.gb_lookup_locks, public.gb_counters from anon, authenticated;

-- 주문번호 순번. 동시에 주문이 들어와도 겹치지 않는다.
create or replace function public.gb_next_order_seq() returns bigint
language sql as $$
  update public.gb_counters set value = value + 1 where name = 'order_seq' returning value;
$$;

-- 데모 공구를 다시 넣을 때 순번이 데모 주문번호와 겹치지 않게 최소값을 올린다.
create or replace function public.gb_reserve_order_seq(minimum bigint) returns bigint
language sql as $$
  update public.gb_counters set value = greatest(value, minimum) where name = 'order_seq' returning value;
$$;

-- 관리자 화면 전체 데이터. 행 수 제한(max rows)을 받지 않도록 jsonb 하나로 돌려준다.
create or replace function public.gb_snapshot() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'groupBuys', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'version', version) order by data->>'createdAt' desc) from public.gb_group_buys), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'version', version) order by created_at desc, order_no desc) from public.gb_orders), '[]'::jsonb),
    'stockLogs', coalesce((select jsonb_agg(data order by created_at desc) from public.gb_stock_logs), '[]'::jsonb),
    'lookupLocks', coalesce((select jsonb_object_agg(phone, data) from public.gb_lookup_locks), '{}'::jsonb),
    'orderSeq', coalesce((select value from public.gb_counters where name = 'order_seq'), 0)
  );
$$;

-- 변경 묶음을 한 트랜잭션으로 적용한다. 하나라도 실패하면 전부 취소된다.
-- put: version이 없으면 새로 넣고(이미 있으면 충돌), 있으면 그 버전일 때만 고친다(다른 곳에서 먼저 고쳤으면 충돌).
-- 충돌은 'GB_CONFLICT'로 시작하는 오류로 알린다. 돌려주는 값은 고친 행의 새 버전.
create or replace function public.gb_commit(changes jsonb) returns jsonb
language plpgsql as $$
declare
  item jsonb;
  next_version integer;
  versions jsonb := jsonb_build_object('groupBuys', '{}'::jsonb, 'orders', '{}'::jsonb);
begin
  for item in select value from jsonb_array_elements(coalesce(changes->'groupBuys', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.gb_group_buys where id = item->>'id';
    elsif item->'version' is null or jsonb_typeof(item->'version') = 'null' then
      insert into public.gb_group_buys (id, slug, data) values (item->>'id', item->>'slug', item->'data')
      on conflict (id) do nothing;
      if not found then raise exception 'GB_CONFLICT group_buy %', item->>'id'; end if;
      versions := jsonb_set(versions, array['groupBuys', item->>'id'], to_jsonb(1));
    else
      update public.gb_group_buys set slug = item->>'slug', data = item->'data', version = version + 1, updated_at = now()
      where id = item->>'id' and version = (item->>'version')::integer
      returning version into next_version;
      if not found then raise exception 'GB_CONFLICT group_buy %', item->>'id'; end if;
      versions := jsonb_set(versions, array['groupBuys', item->>'id'], to_jsonb(next_version));
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'orders', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.gb_orders where id = item->>'id';
    elsif item->'version' is null or jsonb_typeof(item->'version') = 'null' then
      insert into public.gb_orders (id, group_buy_id, order_no, phone, lookup_token, data, created_at)
      values (item->>'id', item->>'groupBuyId', item->>'orderNo', item->>'phone', item->>'lookupToken', item->'data', (item->>'createdAt')::timestamptz)
      on conflict (id) do nothing;
      if not found then raise exception 'GB_CONFLICT order %', item->>'id'; end if;
      versions := jsonb_set(versions, array['orders', item->>'id'], to_jsonb(1));
    else
      update public.gb_orders set group_buy_id = item->>'groupBuyId', phone = item->>'phone', lookup_token = item->>'lookupToken', data = item->'data', version = version + 1, updated_at = now()
      where id = item->>'id' and version = (item->>'version')::integer
      returning version into next_version;
      if not found then raise exception 'GB_CONFLICT order %', item->>'id'; end if;
      versions := jsonb_set(versions, array['orders', item->>'id'], to_jsonb(next_version));
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'stockLogs', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.gb_stock_logs where id = item->>'id';
    else
      insert into public.gb_stock_logs (id, group_buy_id, data, created_at)
      values (item->>'id', item->>'groupBuyId', item->'data', (item->>'createdAt')::timestamptz)
      on conflict (id) do nothing;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(changes->'lookupLocks', '[]'::jsonb)) loop
    if item->>'op' = 'delete' then
      delete from public.gb_lookup_locks where phone = item->>'phone';
    else
      insert into public.gb_lookup_locks (phone, data) values (item->>'phone', item->'data')
      on conflict (phone) do update set data = excluded.data, updated_at = now();
    end if;
  end loop;

  return versions;
end;
$$;

revoke execute on function public.gb_next_order_seq(), public.gb_reserve_order_seq(bigint), public.gb_snapshot(), public.gb_commit(jsonb) from public, anon, authenticated;
grant execute on function public.gb_next_order_seq(), public.gb_reserve_order_seq(bigint), public.gb_snapshot(), public.gb_commit(jsonb) to service_role;

-- 상품 이미지 저장소(누구나 볼 수 있고, 올리기는 서버만).
insert into storage.buckets (id, name, public) values ('gb-images', 'gb-images', true) on conflict (id) do nothing;

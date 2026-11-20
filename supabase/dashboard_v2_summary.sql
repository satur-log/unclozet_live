-- V2 대시보드: 방송 목록용 요약 칸 추가 (dashboard_v2_rows.sql을 실행한 뒤에 실행).
-- 방송 목록 화면은 이 요약만 받아 바로 그린다. 요약은 서버가 저장할 때 같이 계산해 넣고,
-- 비어 있는 기존 방송은 서버가 처음 읽을 때 한 번 계산해 채운다(방송 내용 data·version은 건드리지 않는다).
-- Supabase SQL Editor에서 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다. 데이터를 지우거나 바꾸지 않는다.

alter table public.dashboard_v2_broadcasts add column if not exists summary jsonb;

-- dashboard_v2_rows.sql의 저장 함수와 같고, 방송을 넣거나 고칠 때 summary도 함께 저장하는 것만 다르다.
-- 요약 없이 보내면(예전 코드) summary를 비워 두고, 서버가 다음에 읽을 때 다시 계산한다.
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
      insert into public.dashboard_v2_broadcasts (id, data, summary, created_at)
      values (item->>'id', item->'data', nullif(item->'summary', 'null'::jsonb), coalesce((item->'data'->>'createdAt')::timestamptz, now()))
      on conflict (id) do nothing;
      if not found then raise exception 'DASH_CONFLICT broadcast %', item->>'id'; end if;
      versions := jsonb_set(versions, array['broadcasts', item->>'id'], to_jsonb(1));
    else
      update public.dashboard_v2_broadcasts set data = item->'data', summary = nullif(item->'summary', 'null'::jsonb), version = version + 1, updated_at = now()
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

revoke execute on function public.dashboard_v2_commit(jsonb) from public, anon, authenticated;
grant execute on function public.dashboard_v2_commit(jsonb) to service_role;

-- 확인용: 아래 결과가 summary 한 줄이면 정상
select column_name, data_type from information_schema.columns where table_name = 'dashboard_v2_broadcasts' and column_name = 'summary';

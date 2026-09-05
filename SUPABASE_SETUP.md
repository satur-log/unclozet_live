# Supabase Setup

여러 기기에서 저장 리스트와 주문서 진행 상태를 공유하려면 Supabase 프로젝트에 테이블과 정책을 만들고, Vercel 환경변수를 추가합니다.

> 현재 앱은 로그인 없이 쓰는 내부 도구 구조입니다. 아래 정책은 anon 사용자가 메모와 주문서 정보를 읽고/저장하고/삭제할 수 있게 열어둡니다. 앱 주소를 아는 사람에게 성명, 주소, 전화번호가 노출될 수 있으니 운영 URL은 필요한 사람에게만 공유하세요.

## 1. SQL Editor에서 실행

현재 V2 대시보드는 [`supabase/dashboard_v2_workspaces.sql`](supabase/dashboard_v2_workspaces.sql)의 `dashboard_v2_workspaces` 테이블을 사용합니다. `id = 'main'`인 한 행에 방송·주문·고객 상태를 JSON으로 저장하며, 기존 `live_memos`와 `shipping_rounds`는 V1 복구 및 최초 이전용으로 유지합니다.

아래 SQL은 기존 V1 테이블을 새로 구성할 때만 사용합니다.

```sql
create table if not exists public.live_memos (
  id text primary key,
  title text not null,
  memo text not null default '',
  paid_nicknames jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.live_memos enable row level security;

create policy "live_memos_select_all"
on public.live_memos
for select
to anon
using (true);

create policy "live_memos_insert_all"
on public.live_memos
for insert
to anon
with check (true);

create policy "live_memos_update_all"
on public.live_memos
for update
to anon
using (true)
with check (true);

create policy "live_memos_delete_all"
on public.live_memos
for delete
to anon
using (true);

create table if not exists public.shipping_rounds (
  id text primary key,
  participants jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipping_rounds enable row level security;

create policy "shipping_rounds_select_all"
on public.shipping_rounds
for select
to anon
using (true);

create policy "shipping_rounds_insert_all"
on public.shipping_rounds
for insert
to anon
with check (true);

create policy "shipping_rounds_update_all"
on public.shipping_rounds
for update
to anon
using (true)
with check (true);

create policy "shipping_rounds_delete_all"
on public.shipping_rounds
for delete
to anon
using (true);
```

## 2. Vercel Environment Variables

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Vercel에 환경변수를 넣은 뒤 Production Redeploy를 실행하면 V2 방송·주문·고객 상태가 Supabase와 동기화됩니다. 기존 브라우저의 V2 로컬 데이터는 최초 연결 시 원격 데이터와 한 번 병합됩니다.

`NEXT_PUBLIC_SUPABASE_URL`은 `https://YOUR_PROJECT_REF.supabase.co` 형식을 권장합니다. 실수로 `/rest/v1/`까지 붙여도 앱에서 자동 보정합니다.

## 3. Analytics Environment Variables

PostHog와 Microsoft Clarity를 연결할 때 아래 값을 Vercel Environment Variables에 추가합니다.

```text
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=YOUR_POSTHOG_PROJECT_TOKEN
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_CLARITY_PROJECT_ID=YOUR_CLARITY_PROJECT_ID
```

## Notes

- 로그인 없이 쓰는 구조라 앱 URL을 아는 사람은 저장 리스트를 읽고 수정할 수 있습니다.
- Supabase가 설정되지 않은 경우에는 같은 브라우저의 localStorage에만 저장됩니다.
- Supabase 저장에 실패한 변경은 로컬에 남고 다음 페이지 시작 때 다시 업로드됩니다.

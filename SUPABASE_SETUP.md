# Supabase Setup

여러 기기에서 저장 리스트를 공유하려면 Supabase 프로젝트에 아래 테이블과 정책을 만들고, Vercel 환경변수를 추가합니다.

## 1. SQL Editor에서 실행

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
```

## 2. Vercel Environment Variables

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Vercel에 환경변수를 넣은 뒤 Production Redeploy를 실행하면 저장 리스트가 Supabase와 동기화됩니다.

## Notes

- 로그인 없이 쓰는 구조라 앱 URL을 아는 사람은 저장 리스트를 읽고 수정할 수 있습니다.
- 앱에서는 최근 7일 이내 저장본만 불러오고, 앱이 열릴 때 7일 지난 저장본 정리를 시도합니다.
- Supabase가 설정되지 않은 경우에는 같은 브라우저의 localStorage에만 저장됩니다.

-- 브라우저(anon 키)의 관리자 데이터 접근을 막는다.
-- 대시보드가 서버 API(service_role)로 바뀐 코드가 배포된 "뒤에" 실행한다. 먼저 실행하면 지금 운영 화면이 데이터를 못 읽는다.
-- 순서: 테스트 프로젝트에서 먼저 실행 → Preview 정상 확인 → Production 배포 → 운영 프로젝트에서 실행.
-- 데이터는 지우거나 바꾸지 않는다. 권한과 정책만 바꾼다. 여러 번 실행해도 안전하다.

-- V2 대시보드 작업공간 (고객 이름·주소·전화번호 포함)
drop policy if exists "dashboard_v2_workspaces_select" on public.dashboard_v2_workspaces;
drop policy if exists "dashboard_v2_workspaces_insert" on public.dashboard_v2_workspaces;
drop policy if exists "dashboard_v2_workspaces_update" on public.dashboard_v2_workspaces;
revoke all on public.dashboard_v2_workspaces from anon, authenticated;

-- V1 레거시 테이블 (화면은 이미 / 로 리다이렉트되어 쓰지 않는다)
drop policy if exists "live_memos_select_all" on public.live_memos;
drop policy if exists "live_memos_insert_all" on public.live_memos;
drop policy if exists "live_memos_update_all" on public.live_memos;
drop policy if exists "live_memos_delete_all" on public.live_memos;
revoke all on public.live_memos from anon, authenticated;

drop policy if exists "shipping_rounds_select_all" on public.shipping_rounds;
drop policy if exists "shipping_rounds_insert_all" on public.shipping_rounds;
drop policy if exists "shipping_rounds_update_all" on public.shipping_rounds;
drop policy if exists "shipping_rounds_delete_all" on public.shipping_rounds;
revoke all on public.shipping_rounds from anon, authenticated;

-- 확인용: anon/authenticated 권한이 남아 있으면 행이 나온다. 결과가 비어 있어야 정상.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('dashboard_v2_workspaces', 'live_memos', 'shipping_rounds')
  and grantee in ('anon', 'authenticated');

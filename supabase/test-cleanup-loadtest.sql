-- 부하 테스트 주문 정리. 테스트 프로젝트(fysmejdh…) 전용. 운영 프로젝트에서 실행하지 마세요.
-- 주문자명이 '부하테스트-'로 시작하는 주문과 그 재고 기록만 지웁니다.

-- 1) 지울 대상 확인 (먼저 이것만 실행해서 건수를 보세요)
select count(*) as orders_to_delete from public.gb_orders where data->>'customerName' like '부하테스트-%';

-- 2) 정리
begin;
delete from public.gb_stock_logs
where data->>'orderId' in (select id from public.gb_orders where data->>'customerName' like '부하테스트-%');
delete from public.gb_orders where data->>'customerName' like '부하테스트-%';
commit;

-- 3) 확인: 0이어야 정상
select
  (select count(*) from public.gb_orders where data->>'customerName' like '부하테스트-%') as orders_left,
  (select count(*) from public.gb_stock_logs where data->>'orderId' not in (select id from public.gb_orders)) as orphan_stock_logs;

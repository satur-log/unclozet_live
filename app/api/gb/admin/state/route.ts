import { adminRoute, json } from "../../../../group-buy/server/http";
import { adminSnapshot } from "../../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 관리자 화면 데이터와 행 버전. ?groupBuyId=… 이면 그 공구의 주문·재고 기록까지, 없으면 공구 설정과 공구별 요약만. */
export const GET = adminRoute(async (request) => json(await adminSnapshot(request.nextUrl.searchParams.get("groupBuyId") || null)));

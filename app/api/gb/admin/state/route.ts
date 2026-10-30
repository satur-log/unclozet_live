import { adminRoute, json } from "../../../../group-buy/server/http";
import { adminSnapshot } from "../../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 관리자 화면 전체 데이터(공구·주문·재고 기록)와 행 버전 */
export const GET = adminRoute(async () => json(await adminSnapshot()));

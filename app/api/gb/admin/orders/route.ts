import { adminRoute, json, readJson } from "../../../../group-buy/server/http";
import { adminSubmitOrder } from "../../../../group-buy/server/service";
import type { SubmitRequest } from "../../../../group-buy/model";

export const dynamic = "force-dynamic";

/** 수기 주문 등록. 주문번호는 서버에서 매긴다. */
export const POST = adminRoute(async (request) => json(await adminSubmitOrder(await readJson<SubmitRequest>(request))));

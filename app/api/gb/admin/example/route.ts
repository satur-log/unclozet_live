import { adminRoute, json } from "../../../../group-buy/server/http";
import { insertExample } from "../../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 예시 공구(마약 팬츠)를 주문 없이 넣는다. 이미 있으면 거절. */
export const POST = adminRoute(async () => { await insertExample(); return json({ ok: true }); });

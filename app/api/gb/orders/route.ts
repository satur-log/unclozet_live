import type { NextRequest } from "next/server";
import { failure, json, readJson } from "../../../group-buy/server/http";
import { customerSubmitOrder } from "../../../group-buy/server/service";
import type { SubmitRequest } from "../../../group-buy/model";

export const dynamic = "force-dynamic";

/** 고객 주문서 제출. 금액·주문번호는 서버가 다시 계산한다. */
export async function POST(request: NextRequest) {
  try { return json(await customerSubmitOrder(await readJson<SubmitRequest>(request))); } catch (error) { return failure(error); }
}

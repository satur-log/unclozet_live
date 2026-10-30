import type { NextRequest } from "next/server";
import { failure, json } from "../../../../group-buy/server/http";
import { orderByTokenState } from "../../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 주문 전용 링크 조회 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try { return json(await orderByTokenState((await params).token)); } catch (error) { return failure(error); }
}

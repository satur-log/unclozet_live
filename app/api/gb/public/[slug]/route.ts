import type { NextRequest } from "next/server";
import { failure, json } from "../../../../group-buy/server/http";
import { cachedPublicGroupBuy } from "../../../../group-buy/server/public-cache";

export const dynamic = "force-dynamic";

/** 고객 화면용 공구 정보(재고 수량은 감춤) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try { return json(await cachedPublicGroupBuy(decodeURIComponent((await params).slug))); } catch (error) { return failure(error); }
}

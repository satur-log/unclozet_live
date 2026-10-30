import type { NextRequest } from "next/server";
import { failure, json, readJson } from "../../../group-buy/server/http";
import { lookup } from "../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 휴대폰 번호 + 조회 비밀번호로 주문 조회 */
export async function POST(request: NextRequest) {
  try {
    const { phone = "", pin = "" } = await readJson<{ phone?: string; pin?: string }>(request);
    return json(await lookup(String(phone), String(pin)));
  } catch (error) { return failure(error); }
}

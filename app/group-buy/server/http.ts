import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GroupBuyError } from "../model";
import { ConfigError, ConflictError } from "./backend";

// 공구 API 공통: 오류를 화면에 보여줄 문장으로 바꾸고, 관리자 비밀번호(선택)를 확인한다.

export const ADMIN_COOKIE = "gb_admin";

const noStore = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });

export function failure(error: unknown) {
  if (error instanceof ConflictError) return json({ error: "다른 곳에서 먼저 바뀐 내용이 있어 최신 내용으로 다시 불러왔어요. 한 번 더 해주세요.", code: "CONFLICT" }, 409);
  if (error instanceof GroupBuyError) return json({ error: error.message, code: error.code }, 400);
  if (error instanceof ConfigError) return json({ error: error.message, code: "CONFIG" }, 503);
  console.error("[group-buy api]", error);
  return json({ error: "서버에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", code: "SERVER" }, 500);
}

/** GB_ADMIN_PASSCODE를 넣으면 관리자 API에 비밀번호가 걸린다. 비워두면 열려 있다(로그인 붙이기 전 테스트용). */
const passcode = () => process.env.GB_ADMIN_PASSCODE?.trim() ?? "";
export const adminCookieValue = (code: string) => createHash("sha256").update(`${code}:unclozet-gb-admin`).digest("hex");

export function adminLocked(request: NextRequest) {
  const code = passcode();
  if (!code) return false;
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const expected = adminCookieValue(code);
  return cookie.length !== expected.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}

export function checkPasscode(input: string) {
  const code = passcode();
  if (!code) return true;
  const a = Buffer.from(adminCookieValue(input));
  const b = Buffer.from(adminCookieValue(code));
  return timingSafeEqual(a, b);
}

export const lockedResponse = () => json({ error: "관리자 비밀번호를 입력해 주세요.", code: "LOCKED" }, 401);

/** 관리자 API 래퍼: 비밀번호 확인 → 실행 → 오류 변환 */
export function adminRoute(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) => {
    if (adminLocked(request)) return lockedResponse();
    try { return await handler(request); } catch (error) { return failure(error); }
  };
}

export async function readJson<T>(request: NextRequest): Promise<T> {
  try { return await request.json() as T; } catch { throw new GroupBuyError("INVALID", "요청 형식이 올바르지 않아요."); }
}

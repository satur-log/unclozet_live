import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminCookieValue, checkPasscode, json, readJson } from "../../../../group-buy/server/http";
import { ADMIN_COOKIE_MAX_AGE, adminPasscodeMissingInDeploy } from "../../../../../lib/admin-auth";

export const dynamic = "force-dynamic";

/** 관리자 비밀번호 확인 → 30일 유지되는 쿠키 */
export async function POST(request: NextRequest) {
  const { passcode = "" } = await readJson<{ passcode?: string }>(request).catch(() => ({ passcode: "" }));
  if (adminPasscodeMissingInDeploy()) return json({ error: "관리자 비밀번호가 설정되지 않았어요. Vercel 환경변수 GB_ADMIN_PASSCODE를 넣어주세요.", code: "CONFIG" }, 503);
  // 무작위 대입을 늦춘다.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!checkPasscode(passcode)) return json({ error: "비밀번호가 맞지 않아요.", code: "LOCKED" }, 401);
  const response = json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, adminCookieValue(passcode), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: ADMIN_COOKIE_MAX_AGE });
  return response;
}

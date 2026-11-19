import { createHash, timingSafeEqual } from "node:crypto";

// 관리자 비밀번호(서버 전용). 대시보드·공구 관리자 화면과 API가 같은 쿠키를 쓴다.
// GB_ADMIN_PASSCODE가 비어 있으면: 개발(next dev)에서는 열어두고, 배포(Preview·Production)에서는 잠근다.

export const ADMIN_COOKIE = "gb_admin";
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const adminPasscode = () => process.env.GB_ADMIN_PASSCODE?.trim() ?? "";
export const adminPasscodeMissingInDeploy = () => !adminPasscode() && process.env.NODE_ENV === "production";

export const adminCookieValue = (code: string) => createHash("sha256").update(`${code}:unclozet-gb-admin`).digest("hex");

function same(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 쿠키 값이 현재 비밀번호와 맞는지. 비밀번호 미설정 시 개발에서는 통과, 배포에서는 거부. */
export function adminCookieValid(cookie: string | undefined) {
  const code = adminPasscode();
  if (!code) return process.env.NODE_ENV !== "production";
  return same(cookie ?? "", adminCookieValue(code));
}

export function adminPasscodeMatches(input: string) {
  const code = adminPasscode();
  if (!code) return process.env.NODE_ENV !== "production";
  return same(adminCookieValue(input), adminCookieValue(code));
}

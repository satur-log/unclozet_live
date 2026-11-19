import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminCookieValid } from "./lib/admin-auth";

// 관리자 화면 진입 전 비밀번호 확인. 고객 화면(/pants, /test/gb/…, /api/gb/public 등)은 matcher에 없다.
// 데이터 자체는 관리자 API(adminRoute)가 같은 쿠키로 다시 확인한다. 이 파일은 화면 진입만 막는다.
export function proxy(request: NextRequest) {
  if (adminCookieValid(request.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/",
    "/customers",
    "/broadcasts/:path*",
    "/group-buys/:path*",
    "/test",
    "/test/customers",
    "/test/broadcasts/:path*",
    "/test/group-buys/:path*",
  ],
};

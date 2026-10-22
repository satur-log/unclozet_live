"use client";

import { usePathname } from "next/navigation";
import { DashboardProvider } from "./provider";

// 공구 화면(관리·고객)은 방송 데이터를 쓰지 않는다. 방송 데이터 로딩 화면을 거치지 않고 바로 그린다.
const GROUP_BUY_ROUTE = /^\/(?:test\/)?(?:gb|group-buys)(?:\/|$)/;

export function DashboardRootProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (GROUP_BUY_ROUTE.test(pathname)) return <>{children}</>;
  const mode = pathname === "/test" || pathname.startsWith("/test/") ? "local-test" : "shared";
  return <DashboardProvider key={mode} mode={mode}>{children}</DashboardProvider>;
}

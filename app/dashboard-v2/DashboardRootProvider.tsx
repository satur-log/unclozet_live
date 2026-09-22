"use client";

import { usePathname } from "next/navigation";
import { DashboardProvider } from "./provider";

export function DashboardRootProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mode = pathname === "/test" || pathname.startsWith("/test/") ? "local-test" : "shared";
  return <DashboardProvider key={mode} mode={mode}>{children}</DashboardProvider>;
}

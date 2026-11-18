"use client";

import type { ReactNode } from "react";
import { DashboardProvider } from "./provider";

export function DashboardPageProvider({ children, mode = "shared" }: { children: ReactNode; mode?: "shared" | "local-test" }) {
  return <DashboardProvider key={mode} mode={mode}>{children}</DashboardProvider>;
}

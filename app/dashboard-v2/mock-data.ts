import type { DashboardState } from "./types";

// V2 starts as an empty local workspace. No customer or order fixtures are shipped.
export function createMockState(): DashboardState {
  return { version: 2, broadcasts: [], customers: [] };
}

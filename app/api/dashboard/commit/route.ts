import type { NextRequest } from "next/server";
import { adminLocked, json, lockedResponse } from "../../../group-buy/server/http";
import { commitDashboard } from "../../../dashboard-v2/server/workspace-store";
import type { DashboardChanges } from "../../../dashboard-v2/row-sync";
import { dashboardFailure } from "../../../dashboard-v2/server/http";

export const dynamic = "force-dynamic";

/** 바뀐 방송·고객 행 묶음 저장. 다른 곳에서 먼저 고친 행이 있으면 409(CONFLICT). */
export async function POST(request: NextRequest) {
  if (adminLocked(request)) return lockedResponse();
  try {
    const body = await request.json().catch(() => null) as { changes?: Partial<DashboardChanges> } | null;
    const changes = body?.changes;
    if (!changes || !Array.isArray(changes.broadcasts) || !Array.isArray(changes.customers)) return json({ error: "요청 형식이 올바르지 않아요.", code: "INVALID" }, 400);
    const ok = (item: unknown) => Boolean(item && typeof item === "object" && ["put", "delete"].includes(String((item as { op?: unknown }).op)) && typeof (item as { id?: unknown }).id === "string");
    if (!changes.broadcasts.every(ok) || !changes.customers.every(ok)) return json({ error: "요청 형식이 올바르지 않아요.", code: "INVALID" }, 400);
    return json({ versions: await commitDashboard(changes as DashboardChanges) });
  } catch (error) { return dashboardFailure(error); }
}

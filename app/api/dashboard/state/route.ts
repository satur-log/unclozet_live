import type { NextRequest } from "next/server";
import { adminLocked, json, lockedResponse } from "../../../group-buy/server/http";
import { readWorkspace, WorkspaceConfigError, WorkspaceConflictError, WorkspaceMissingError, writeWorkspace } from "../../../dashboard-v2/server/workspace-store";
import type { DashboardState } from "../../../dashboard-v2/types";

export const dynamic = "force-dynamic";
// 고객 617명 분량의 JSON을 한 번에 주고받는다.
export const maxDuration = 30;

function failure(error: unknown) {
  if (error instanceof WorkspaceConflictError) return json({ error: error.message, code: "CONFLICT" }, 409);
  if (error instanceof WorkspaceMissingError) return json({ error: error.message, code: "MISSING" }, 404);
  if (error instanceof WorkspaceConfigError) return json({ error: error.message, code: "CONFIG" }, 503);
  console.error("[dashboard api]", error);
  return json({ error: error instanceof Error ? error.message : "서버에서 처리하지 못했어요.", code: "SERVER" }, 500);
}

export async function GET(request: NextRequest) {
  if (adminLocked(request)) return lockedResponse();
  try {
    const workspace = await readWorkspace();
    if (!workspace) return json({ mode: "local" });
    return json({ mode: "remote", ...workspace });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  if (adminLocked(request)) return lockedResponse();
  try {
    const body = await request.json().catch(() => null) as { state?: DashboardState; baseUpdatedAt?: unknown } | null;
    if (!body?.state || typeof body.baseUpdatedAt !== "string" || !body.baseUpdatedAt) return json({ error: "요청 형식이 올바르지 않아요.", code: "INVALID" }, 400);
    return json(await writeWorkspace(body.state, body.baseUpdatedAt));
  } catch (error) { return failure(error); }
}

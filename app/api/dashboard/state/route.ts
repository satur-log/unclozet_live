import type { NextRequest } from "next/server";
import { adminLocked, json, lockedResponse } from "../../../group-buy/server/http";
import { readBroadcastPage, readCustomers, workspaceConfigured, workspaceProjectRef } from "../../../dashboard-v2/server/workspace-store";
import { dashboardFailure } from "../../../dashboard-v2/server/http";
import { BROADCAST_PAGE_SIZE } from "../../../dashboard-v2/row-sync";

export const dynamic = "force-dynamic";

/**
 * ?part=customers            → 고객 전체와 행 버전
 * ?part=broadcasts&offset=N  → 방송 한 페이지(최신 먼저, BROADCAST_PAGE_SIZE건)와 전체 방송 수
 * Supabase 미설정 개발 환경이면 { mode: "local" }.
 */
export async function GET(request: NextRequest) {
  if (adminLocked(request)) return lockedResponse();
  try {
    if (!workspaceConfigured()) return json({ mode: "local" });
    const params = request.nextUrl.searchParams;
    if (params.get("part") === "customers") {
      const result = await readCustomers();
      return json({ mode: "remote", project: workspaceProjectRef(), ...result });
    }
    if (params.get("part") === "broadcasts") {
      const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
      const result = await readBroadcastPage(offset, BROADCAST_PAGE_SIZE);
      return json({ mode: "remote", project: workspaceProjectRef(), offset, pageSize: BROADCAST_PAGE_SIZE, ...result });
    }
    return json({ error: "part=customers 또는 part=broadcasts가 필요해요.", code: "INVALID" }, 400);
  } catch (error) { return dashboardFailure(error); }
}

/** 예전 방식(전체 JSON 저장). 배포 전에 열어 둔 화면이 옛 저장소에 쓰지 못하게 막는다. */
export async function PUT(request: NextRequest) {
  if (adminLocked(request)) return lockedResponse();
  return json({ error: "대시보드가 새 버전으로 바뀌었어요. 페이지를 새로고침한 뒤 다시 해주세요.", code: "MOVED" }, 409);
}

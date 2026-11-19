import { isDashboardState } from "../repository";
import type { DashboardState } from "../types";

// V2 대시보드 공유 작업공간(서버 전용). service_role 키로만 Supabase에 접근한다.
// 저장은 "내가 마지막으로 본 updated_at"과 같을 때만 성공한다. 다른 곳에서 먼저 저장했으면 충돌로 거절한다.

export const WORKSPACE_ID = "main";

export class WorkspaceConflictError extends Error {}
export class WorkspaceMissingError extends Error {}
export class WorkspaceConfigError extends Error {}

type Config = { rest: string; headers: Record<string, string> };

function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV === "production") throw new WorkspaceConfigError("대시보드 저장소가 연결되지 않았어요. Vercel 환경변수 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요.");
    return null;
  }
  const auth: Record<string, string> = key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  return { rest: `${url}/rest/v1`, headers: { ...auth, "Content-Type": "application/json" } };
}

export type Workspace = { state: DashboardState; updatedAt: string };

/** null = 개발 환경에서 Supabase 미설정(브라우저 로컬 모드로 동작) */
export async function readWorkspace(): Promise<Workspace | null> {
  const c = config();
  if (!c) return null;
  const response = await fetch(`${c.rest}/dashboard_v2_workspaces?id=eq.${WORKSPACE_ID}&select=state,updated_at&limit=1`, { headers: c.headers, cache: "no-store" });
  if (!response.ok) throw new Error(`공유 데이터를 불러오지 못했어요. (${response.status})`);
  const rows = await response.json() as { state?: unknown; updated_at?: string }[];
  if (!Array.isArray(rows) || rows.length === 0) throw new WorkspaceMissingError("Supabase 공유 작업공간(main)을 찾지 못했어요.");
  const row = rows[0];
  if (!isDashboardState(row.state) || typeof row.updated_at !== "string") throw new Error("Supabase의 V2 데이터 형식이 올바르지 않아요.");
  return { state: row.state, updatedAt: row.updated_at };
}

/** baseUpdatedAt이 지금 저장된 값과 같을 때만 고친다. 행을 새로 만들지는 않는다. */
export async function writeWorkspace(state: DashboardState, baseUpdatedAt: string): Promise<{ updatedAt: string }> {
  const c = config();
  if (!c) throw new WorkspaceConfigError("Supabase가 연결되지 않아 저장할 수 없어요.");
  if (!isDashboardState(state)) throw new Error("저장할 V2 데이터 형식이 올바르지 않아요.");
  const response = await fetch(
    `${c.rest}/dashboard_v2_workspaces?id=eq.${WORKSPACE_ID}&updated_at=eq.${encodeURIComponent(baseUpdatedAt)}&select=updated_at`,
    {
      method: "PATCH",
      headers: { ...c.headers, Prefer: "return=representation" },
      body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`Supabase에 저장하지 못했어요. (${response.status})`);
  const rows = await response.json() as { updated_at?: string }[];
  if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0].updated_at !== "string") {
    throw new WorkspaceConflictError("다른 곳에서 먼저 저장한 내용이 있어요.");
  }
  return { updatedAt: rows[0].updated_at };
}

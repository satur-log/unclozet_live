import { json } from "../../group-buy/server/http";
import { WorkspaceConfigError, WorkspaceConflictError } from "./workspace-store";

/** 대시보드 API 오류 → 화면에 보여줄 문장과 상태 코드 */
export function dashboardFailure(error: unknown) {
  if (error instanceof WorkspaceConflictError) return json({ error: error.message, code: "CONFLICT" }, 409);
  if (error instanceof WorkspaceConfigError) return json({ error: error.message, code: "CONFIG" }, 503);
  console.error("[dashboard api]", error);
  return json({ error: error instanceof Error ? error.message : "서버에서 처리하지 못했어요.", code: "SERVER" }, 500);
}

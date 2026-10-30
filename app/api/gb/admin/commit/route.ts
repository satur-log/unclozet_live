import { adminRoute, json, readJson } from "../../../../group-buy/server/http";
import { adminCommit } from "../../../../group-buy/server/service";
import type { Changes } from "../../../../group-buy/sync";

export const dynamic = "force-dynamic";

/** 관리자 화면에서 바뀐 행 묶음을 한 번에 저장한다. 다른 곳에서 먼저 고친 행이 있으면 409. */
export const POST = adminRoute(async (request) => {
  const body = await readJson<{ changes: Changes }>(request);
  return json({ versions: await adminCommit(body.changes) });
});

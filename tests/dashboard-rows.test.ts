import test from "node:test";
import assert from "node:assert/strict";
import { addBroadcast, deleteBroadcast, editCustomer, ensureCustomer, renameBroadcast } from "../app/dashboard-v2/model";
import { createMockState } from "../app/dashboard-v2/mock-data";
import { applyRowVersions, diffDashboard, hasDashboardChanges, sortBroadcasts, type RowVersions } from "../app/dashboard-v2/row-sync";
import type { DashboardState } from "../app/dashboard-v2/types";

function seeded(): { state: DashboardState; versions: RowVersions; broadcastIds: string[]; customerId: string } {
  let state = createMockState();
  const ids: string[] = [];
  for (const title of ["첫 방송", "둘째 방송", "셋째 방송"]) { const result = addBroadcast(state, title); state = result.state; ids.push(result.broadcastId); }
  const customer = ensureCustomer(state, "row_test_user");
  state = customer.state;
  const versions: RowVersions = { broadcasts: Object.fromEntries(ids.map((id) => [id, 3])), customers: { [customer.customerId]: 7 } };
  return { state, versions, broadcastIds: ids, customerId: customer.customerId };
}

test("행 diff: 바꾼 방송 하나만 보낸다", () => {
  const { state, versions, broadcastIds } = seeded();
  const next = renameBroadcast(state, broadcastIds[1], "이름 바꾼 방송");
  const changes = diffDashboard(state, next, versions);
  assert.deepEqual(changes.broadcasts.map((change) => [change.op, change.id, change.version]), [["put", broadcastIds[1], 3]]);
  assert.equal(changes.customers.length, 0);
});

test("행 diff: 새 방송은 version 없이, 지운 방송은 마지막 버전과 함께", () => {
  const { state, versions, broadcastIds } = seeded();
  const added = addBroadcast(state, "새 방송");
  const next = deleteBroadcast(added.state, broadcastIds[0]);
  const changes = diffDashboard(state, next, versions);
  assert.deepEqual(changes.broadcasts.map((change) => [change.op, change.id, change.version]).sort(), [["delete", broadcastIds[0], 3], ["put", added.broadcastId, null]].sort());
});

test("행 diff: 고객 수정은 고객 행만, 변화가 없으면 아무것도 보내지 않는다", () => {
  const { state, versions, customerId } = seeded();
  const next = editCustomer(state, customerId, { name: "홍길동", address: "서울 중구 세종대로 1", phone: "010-1234-5678" });
  const changes = diffDashboard(state, next, versions);
  assert.deepEqual(changes.customers.map((change) => [change.op, change.id, change.version]), [["put", customerId, 7]]);
  assert.equal(changes.broadcasts.length, 0);
  assert.equal(hasDashboardChanges(diffDashboard(state, structuredClone(state), versions)), false, "내용이 같으면 객체가 달라도 보내지 않는다");
});

test("서버가 돌려준 버전을 반영하고 지운 행 버전은 버린다", () => {
  const { state, versions, broadcastIds } = seeded();
  const next = deleteBroadcast(renameBroadcast(state, broadcastIds[1], "바꿈"), broadcastIds[2]);
  const changes = diffDashboard(state, next, versions);
  const applied = applyRowVersions(versions, changes, { broadcasts: { [broadcastIds[1]]: 4 } });
  assert.equal(applied.broadcasts[broadcastIds[1]], 4);
  assert.equal(applied.broadcasts[broadcastIds[0]], 3);
  assert.equal(broadcastIds[2] in applied.broadcasts, false);
});

test("방송 순서는 최신 먼저(서버 페이지 순서와 같음)", () => {
  const sorted = sortBroadcasts([{ id: "a", createdAt: "2026-01-01" }, { id: "b", createdAt: "2026-03-01" }, { id: "c", createdAt: "2026-02-01" }] as never);
  assert.deepEqual(sorted.map((item: { id: string }) => item.id), ["b", "c", "a"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { adjustStock, confirmPayments, deleteGroupBuy, setSoldOut } from "../app/group-buy/model";
import { createSeedState } from "../app/group-buy/mock";
import { applyChangesToDb, backend, ConflictError } from "../app/group-buy/server/backend";
import { adminCommit, adminSnapshot, adminSubmitOrder, customerSubmitOrder, EXAMPLE_GROUP_BUY_ID as DEMO_GROUP_BUY_ID, insertExample, lookup, orderByTokenState, publicGroupBuyState } from "../app/group-buy/server/service";
import { diffState, publicOrder, storedGroupBuy, withOrderedQty, type Versions } from "../app/group-buy/sync";
import type { CustomerInput } from "../app/group-buy/types";

// 서버 기능은 개발용 파일 저장소로 시험한다(Supabase gb_commit과 같은 규칙).
process.env.GB_DEV_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gb-sync-")), "db.json");

const noVersions: Versions = { groupBuys: {}, orders: {} };
const customer: CustomerInput = { customerName: "테스트", phone: "010-9999-0001", recipientName: "테스트", recipientPhone: "010-9999-0001", postcode: "06236", address: "서울 강남구 테헤란로 1", addressDetail: "1층", shippingMessage: "", depositorName: "테스트", pin: "4321" };

test("주문 수량(orderedQty)은 주문에서 다시 계산한 값과 같다", () => {
  const seed = createSeedState();
  assert.deepEqual(withOrderedQty(seed).groupBuys, seed.groupBuys);
});

test("diffState: 바뀐 행만 고르고, 주문 수량 차이는 공구 변경으로 보지 않는다", () => {
  const seed = createSeedState();
  const waiting = seed.orders.filter((order) => order.status === "WAITING").slice(0, 2).map((order) => order.id);
  const paid = diffState(seed, confirmPayments(seed, waiting), noVersions);
  assert.deepEqual(paid.orders.map((item) => item.id).sort(), [...waiting].sort());
  assert.equal(paid.groupBuys.length, 0);

  const optionId = seed.groupBuys[0].products[0].options[0].id;
  const adjusted = diffState(seed, adjustStock(seed, DEMO_GROUP_BUY_ID, optionId, 5, "입고"), noVersions);
  assert.equal(adjusted.groupBuys.length, 1);
  assert.equal(adjusted.stockLogs.length, 1);
  assert.equal(adjusted.orders.length, 0);
  // 저장하는 공구에는 주문 수량을 넣지 않는다
  assert.ok(adjusted.groupBuys.every((item) => item.op === "put" && item.data.products.every((product) => product.options.every((option) => option.orderedQty === 0))));

  const removed = diffState(seed, deleteGroupBuy(seed, DEMO_GROUP_BUY_ID).state, noVersions);
  assert.equal(removed.groupBuys[0].op, "delete");
  assert.equal(removed.orders.filter((item) => item.op === "delete").length, seed.orders.length);
});

test("applyChangesToDb: 버전이 다르면 충돌, 하나라도 충돌하면 아무것도 바꾸지 않는다", () => {
  const seed = createSeedState();
  const groupBuy = storedGroupBuy(seed.groupBuys[0]);
  const empty = { groupBuys: {}, orders: {}, stockLogs: {}, lookupLocks: {}, orderSeq: 0 };
  const { db } = applyChangesToDb(empty, { groupBuys: [{ op: "put", id: groupBuy.id, slug: groupBuy.slug, data: groupBuy, version: null }], orders: [], stockLogs: [], lookupLocks: [] });
  assert.throws(() => applyChangesToDb(db, { groupBuys: [{ op: "put", id: groupBuy.id, slug: groupBuy.slug, data: groupBuy, version: 7 }], orders: [], stockLogs: [], lookupLocks: [] }), ConflictError);
  assert.equal(db.groupBuys[groupBuy.id].version, 1);
});

test("서버: 예시 넣기는 주문 없이 공구만", async () => {
  await insertExample();
  const snapshot = await adminSnapshot();
  assert.equal(snapshot.state.groupBuys.length, 1);
  assert.equal(snapshot.state.orders.length, 0);
  assert.ok(snapshot.state.groupBuys[0].products[0].options.every((option) => !option.soldOut && option.orderedQty === 0));
  await assert.rejects(insertExample(), /이미 있어요/);
  // 다음 시험을 위해 비운다
  await adminCommit({ groupBuys: [{ op: "delete", id: DEMO_GROUP_BUY_ID }], orders: [], stockLogs: [], lookupLocks: [] });
});

test("서버: 데모 데이터 → 고객 주문(동시에 여러 건) → 조회 → 충돌", async () => {
  const seed = createSeedState();
  // 데모 주문번호(1~N)와 새 주문번호가 겹치지 않게 순번을 올리고 데모를 넣는다.
  await backend().reserveOrderSeq(seed.orderSeq);
  await adminCommit(diffState({ ...seed, groupBuys: [], orders: [], stockLogs: [] }, seed, noVersions));
  let snapshot = await adminSnapshot();
  assert.equal(snapshot.state.orders.length, seed.orders.length);
  assert.ok(snapshot.state.orderSeq >= seed.orderSeq);

  // 고객 화면에는 재고 수량이 가려진다
  const publicState = await publicGroupBuyState("pants");
  assert.equal(publicState.groupBuys[0].products[0].options[0].stockQty, null);
  assert.equal(publicState.orders.length, 0);

  // 동시에 들어온 주문도 주문번호가 겹치지 않는다
  const optionId = seed.groupBuys[0].products[0].options[1].id;
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => customerSubmitOrder({ groupBuyId: DEMO_GROUP_BUY_ID, lines: [{ optionId, quantity: 1 }], input: { ...customer, phone: `010-9999-000${n}`, recipientPhone: `010-9999-000${n}` }, expectedTotal: null, source: "form" })));
  assert.ok(results.every((result) => result.ok));
  const orderNos = results.map((result) => result.ok ? result.order.orderNo : "");
  assert.equal(new Set(orderNos).size, 5);
  assert.ok(results.every((result) => result.ok && result.order.lookupPinHash === ""), "고객에게 비밀번호 해시를 보내지 않는다");

  // 금액을 조작해 보내도 서버 계산과 다르면 다시 확인받는다
  const tampered = await customerSubmitOrder({ groupBuyId: DEMO_GROUP_BUY_ID, lines: [{ optionId, quantity: 1 }], input: customer, expectedTotal: 100, source: "form" });
  assert.equal(tampered.ok ? "ok" : tampered.code, "PRICE_CHANGED");

  // 품절 확정 옵션은 고객 주문이 막히고, 수기 주문은 허용 옵션으로 넣을 수 있다
  snapshot = await adminSnapshot();
  const soldOut = snapshot.state.groupBuys[0].products[0].options.find((option) => option.soldOut)!;
  const blocked = await customerSubmitOrder({ groupBuyId: DEMO_GROUP_BUY_ID, lines: [{ optionId: soldOut.id, quantity: 1 }], input: customer, expectedTotal: null, source: "form", allowOverStock: true });
  assert.equal(blocked.ok ? "ok" : blocked.code, "STOCK");
  const manual = await adminSubmitOrder({ groupBuyId: DEMO_GROUP_BUY_ID, lines: [{ optionId: soldOut.id, quantity: 1 }], input: customer, expectedTotal: null, source: "manual", allowOverStock: true });
  assert.ok(manual.ok);

  // 주문 수량은 새 주문까지 반영된다
  snapshot = await adminSnapshot();
  const ordered = snapshot.state.groupBuys[0].products[0].options.find((option) => option.id === optionId)!.orderedQty;
  assert.equal(ordered, withOrderedQty(snapshot.state).groupBuys[0].products[0].options.find((option) => option.id === optionId)!.orderedQty);

  // 전용 링크 조회
  const first = results[0].ok ? results[0].order : null;
  const byToken = await orderByTokenState(first!.lookupToken);
  assert.equal(byToken.orders[0].id, first!.id);
  assert.equal((await orderByTokenState("not-a-token")).orders.length, 0);

  // 휴대폰 + 비밀번호 조회, 5번 틀리면 잠금
  const phone = "010-9999-0003";
  assert.ok((await lookup(phone, "4321")).ok);
  for (let i = 0; i < 4; i += 1) assert.equal((await lookup(phone, "0000")).ok, false);
  const locked = await lookup(phone, "0000");
  assert.ok(!locked.ok && locked.lockedUntil);
  const stillLocked = await lookup(phone, "4321");
  assert.ok(!stillLocked.ok, "잠긴 동안은 맞는 비밀번호도 막는다");

  // 관리자: 오래된 버전으로 저장하면 충돌
  const order = snapshot.state.orders[0];
  const version = snapshot.versions.orders[order.id];
  await adminCommit({ groupBuys: [], orders: [{ op: "put", id: order.id, groupBuyId: order.groupBuyId, orderNo: order.orderNo, phone: order.phone, lookupToken: order.lookupToken, createdAt: order.createdAt, data: { ...order, sellerNote: "첫 번째" }, version }], stockLogs: [], lookupLocks: [] });
  await assert.rejects(adminCommit({ groupBuys: [], orders: [{ op: "put", id: order.id, groupBuyId: order.groupBuyId, orderNo: order.orderNo, phone: order.phone, lookupToken: order.lookupToken, createdAt: order.createdAt, data: { ...order, sellerNote: "두 번째" }, version }], stockLogs: [], lookupLocks: [] }), ConflictError);

  // 관리자 변경(품절 해제)을 diff로 저장하면 다음 스냅샷에 반영된다
  const fresh = await adminSnapshot();
  await adminCommit(diffState(fresh.state, setSoldOut(fresh.state, DEMO_GROUP_BUY_ID, soldOut.id, false), fresh.versions));
  assert.equal((await adminSnapshot()).state.groupBuys[0].products[0].options.find((option) => option.id === soldOut.id)!.soldOut, false);
});

test("publicOrder는 판매자 내부 기록을 뺀다", () => {
  const order = createSeedState().orders[0];
  const shown = publicOrder(order);
  assert.equal(shown.lookupPinHash, "");
  assert.deepEqual(shown.events, []);
});

test("관리자 비밀번호(GB_ADMIN_PASSCODE): 설정하면 쿠키 없이는 잠긴다", async () => {
  const { NextRequest } = await import("next/server");
  const { ADMIN_COOKIE, adminCookieValue, adminLocked, checkPasscode } = await import("../app/group-buy/server/http");
  const request = (cookie?: string) => new NextRequest("http://localhost/api/gb/admin/state", { headers: cookie ? { cookie: `${ADMIN_COOKIE}=${cookie}` } : {} });
  delete process.env.GB_ADMIN_PASSCODE;
  assert.equal(adminLocked(request()), false, "설정 안 하면 열려 있다");
  process.env.GB_ADMIN_PASSCODE = "test-pass-1";
  try {
    assert.equal(adminLocked(request()), true);
    assert.equal(adminLocked(request("wrong")), true);
    assert.equal(adminLocked(request(adminCookieValue("test-pass-1"))), false);
    assert.equal(checkPasscode("test-pass-1"), true);
    assert.equal(checkPasscode("test-pass-2"), false);
  } finally { delete process.env.GB_ADMIN_PASSCODE; }
});

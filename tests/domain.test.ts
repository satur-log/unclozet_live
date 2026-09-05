import assert from "node:assert/strict";
import test from "node:test";
import readXlsxFile from "read-excel-file/node";
import { analyzeSettlement } from "../app/dashboard-v2/settlement";
import { normalizePhoneNumber, parseKakaoOrder } from "../app/dashboard-v2/shipping-parser";
import { parseCustomerWorkbookRows } from "../app/dashboard-v2/customer-import";
import { mergeLegacyData } from "../app/dashboard-v2/legacy-import";
import { createShippingWorkbook } from "../app/dashboard-v2/workbook";
import {
  addBroadcast, addCustomerCheck, confirmPreviousInfo, customerCheckCount, customerLastOrderedAt, customerOrderHistory, customerStatusLabel, deleteBroadcast, deleteCustomer,
  deleteCustomerCheck, editCustomer, editCustomerCheck, editOrder, exportReadyOrders, importCustomers, registerOrder, resolveConflict, restoreOrder,
  saveSettlement, setCustomerBlocked,
} from "../app/dashboard-v2/model";
import { createMockState } from "../app/dashboard-v2/mock-data";
import { isDashboardState, loadMockState, saveMockState, STORAGE_KEY } from "../app/dashboard-v2/repository";
import { mergeDashboardStates } from "../app/dashboard-v2/remote-repository";
import type { DashboardState, Delivery } from "../app/dashboard-v2/types";

const info = (room = "101"): Delivery => ({ name: "테스트가람", address: `테스트시 가상구 샘플로 0 ${room}호`, phone: "010-1234-5678" });
function emptyState(): DashboardState { return { version: 2, broadcasts: [], customers: [] }; }
function setup(instagramIds = ["case.dot", "2.case__under"]) {
  let state = emptyState(); const added = addBroadcast(state, "테스트 방송"); state = added.state;
  state = saveSettlement(state, added.broadcastId, instagramIds.map((name, i) => `${name} - ${i + 1}번 ${i + 1}.5`).join("\n"));
  return { state, broadcastId: added.broadcastId };
}

test("existing settlement parser behavior is retained and invalid residue is reported", () => {
  const parsed = analyzeSettlement("배송 안내 문구는 정산에서 제외\ncase.dot - 1번 1.5 + 2번 2.0\ncase__under - 15,000\nbroken - 1.2 + 메모확인");
  assert.equal(parsed.buyers.length, 2);
  assert.equal(parsed.buyers[0].total, 35_000);
  assert.equal(parsed.buyers[1].total, 15_000);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.announcement, /case\.dot/);
  assert.doesNotMatch(parsed.announcement, /배송 안내/);
});

test("non-settlement prose is ignored without adding errors to valid orders", () => {
  let { state, broadcastId } = setup(["case.dot"]);
  state = saveSettlement(state, broadcastId, "방송 공지입니다\ncase.dot - 1.5\nbroken.case - 1.2 + 메모확인\n오늘 배송은 쉽니다");
  assert.equal(state.broadcasts[0].settlementErrors.length, 1);
  state = registerOrder(state, broadcastId, `인스타 아이디: case.dot\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  assert.equal(state.broadcasts[0].orders.find((order) => order.instagramId === "case.dot")?.status, "READY");
});

test("order parser accepts dot, consecutive underscore and digit-leading IDs", () => {
  for (const instagramId of ["case.dot", "case__under", "2.case__under"]) {
    const parsed = parseKakaoOrder(`인스타 아이디: ${instagramId}\n성함: 테스트나래\n주소: 테스트시 가상구 샘플로 0 101호\n연락처: 01012345678`, []);
    assert.equal(parsed.instagramId, instagramId);
    assert.equal(parsed.shippingInfo.phone1, "010-1234-5678");
  }

  const multiLineFreeform = parseKakaoOrder("gwangsoo_m, 이광수\n광주시 동구 필문대로 1\n01077774444", []);
  assert.equal(multiLineFreeform.instagramId, "gwangsoo_m");
  assert.equal(multiLineFreeform.shippingInfo.name, "이광수");
  assert.equal(multiLineFreeform.shippingInfo.address, "광주시 동구 필문대로 1");
  assert.equal(multiLineFreeform.shippingInfo.phone1, "010-7777-4444");

  const oneLineFreeform = parseKakaoOrder("areum_glow 백아름 서울시 동작구 사당로 12 010-5555-6666", []);
  assert.equal(oneLineFreeform.instagramId, "areum_glow");
  assert.equal(oneLineFreeform.shippingInfo.name, "백아름");
  assert.equal(oneLineFreeform.shippingInfo.address, "서울시 동작구 사당로 12");
  assert.equal(oneLineFreeform.shippingInfo.phone1, "010-5555-6666");
  assert.equal(normalizePhoneNumber("12345678"), "12345678");
});

test("new and unchanged customer orders become READY, changed customer waits for a choice", () => {
  let { state, broadcastId } = setup(["new.case", "same.case", "change.case"]);
  state.customers = [
    { id: "same", instagramId: "same.case", delivery: info("201"), updatedAt: new Date().toISOString() },
    { id: "change", instagramId: "change.case", delivery: info("301"), updatedAt: new Date().toISOString() },
  ];
  state = registerOrder(state, broadcastId, `인스타 아이디: new.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  state = registerOrder(state, broadcastId, `인스타 아이디: same.case\n성함: ${info("201").name}\n주소: ${info("201").address}\n연락처: ${info("201").phone}`).state;
  const changed = registerOrder(state, broadcastId, `인스타 아이디: change.case\n성함: ${info("302").name}\n주소: ${info("302").address}\n연락처: ${info("302").phone}`);
  state = changed.state;
  const orders = state.broadcasts[0].orders;
  assert.equal(orders.find((o) => o.instagramId === "new.case")?.status, "READY");
  assert.equal(orders.find((o) => o.instagramId === "same.case")?.status, "READY");
  assert.equal(orders.find((o) => o.instagramId === "change.case")?.status, "WAITING");
  assert.ok(orders.find((o) => o.instagramId === "change.case")?.conflict);
  state = resolveConflict(state, broadcastId, changed.orderId, "incoming");
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === changed.orderId)?.status, "READY");
  assert.match(state.customers.find((c) => c.id === "change")?.delivery.address ?? "", /302호/);
});

test("historical information requires confirmation and incomplete orders wait until fixed", () => {
  let { state, broadcastId } = setup(["return.case", "missing.case"]);
  state.customers = [{ id: "return", instagramId: "return.case", delivery: info(), updatedAt: new Date().toISOString() }];
  // Reapply settlement so the customer card is prefilled in the new broadcast.
  state = saveSettlement(state, broadcastId, "return.case - 1.5\nmissing.case - 2.0");
  const historical = state.broadcasts[0].orders.find((o) => o.instagramId === "return.case")!;
  assert.equal(historical.status, "WAITING");
  assert.equal(historical.registrationConfirmed, false);
  state = confirmPreviousInfo(state, broadcastId, historical.id);
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === historical.id)?.status, "READY");
  const missing = registerOrder(state, broadcastId, "인스타 아이디: missing.case\n성함: 테스트보라\n주소:\n연락처: 01012345678");
  state = missing.state;
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === missing.orderId)?.status, "WAITING");
  state = editOrder(state, broadcastId, missing.orderId, info("401"));
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === missing.orderId)?.status, "READY");
});

test("READY information remains editable and export handles every READY order atomically", () => {
  let { state, broadcastId } = setup(["ready.one", "ready.two"]);
  for (const instagramId of ["ready.one", "ready.two"]) state = registerOrder(state, broadcastId, `인스타 아이디: ${instagramId}\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const order = state.broadcasts[0].orders.find((o) => o.instagramId === "ready.one")!;
  state = editOrder(state, broadcastId, order.id, info("777"));
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === order.id)?.status, "READY");
  assert.match(state.broadcasts[0].orders.find((o) => o.id === order.id)?.delivery?.address ?? "", /777호/);
  state = editOrder(state, broadcastId, order.id, info("777"), "@revised.case");
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === order.id)?.instagramId, "revised.case");
  assert.ok(state.customers.some((customer) => customer.instagramId === "revised.case"));
  const before = state;
  assert.throws(() => exportReadyOrders(state, broadcastId, () => { throw new Error("download failed"); }), /download failed/);
  assert.equal(before.broadcasts[0].orders.filter((o) => o.status === "READY").length, 2);
  let workbook = new Uint8Array(); let name = "";
  state = exportReadyOrders(state, broadcastId, (bytes, fileName) => { workbook = new Uint8Array(bytes); name = fileName; });
  assert.equal(String.fromCharCode(workbook[0], workbook[1]), "PK");
  const workbookText = new TextDecoder().decode(workbook);
  assert.match(workbookText, /받는분성명/);
  assert.match(workbookText, /010-1234-5678/);
  assert.match(workbookText, /<mergeCell ref="A1:G1"\/>/);
  const firstDataRow = workbookText.match(/<row r="3">(.+?)<\/row>/)?.[1] ?? "";
  assert.equal((firstDataRow.match(/<c /g) ?? []).length, 7);
  assert.match(firstDataRow, /revised\.case/);
  assert.doesNotMatch(workbookText, /배송 메모 테스트/);
  assert.match(name, /2건\.xlsx$/);
  assert.equal(state.broadcasts[0].orders.filter((o) => o.status === "COMPLETED").length, 2);
  state = restoreOrder(state, broadcastId, order.id);
  assert.equal(state.broadcasts[0].orders.find((o) => o.id === order.id)?.status, "READY");
});

test("customer deletion leaves historical broadcast orders intact", () => {
  let { state, broadcastId } = setup(["delete.case"]);
  state = registerOrder(state, broadcastId, `인스타 아이디: delete.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const customer = state.customers[0]; const orderCount = state.broadcasts.reduce((n, b) => n + b.orders.length, 0);
  state = deleteCustomer(state, customer.id);
  assert.equal(state.customers.some((c) => c.id === customer.id), false);
  assert.equal(state.broadcasts.reduce((n, b) => n + b.orders.length, 0), orderCount);
});

test("customer information and Instagram ID can be edited and are normalized", () => {
  let { state, broadcastId } = setup(["edit.case"]);
  state = registerOrder(state, broadcastId, `인스타 아이디: edit.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const customer = state.customers[0];
  state = editCustomer(state, customer.id, { name: "수정 고객", address: "서울시 수정구 수정로 2", phone: "01099998888" }, "@updated.case");
  assert.deepEqual(state.customers[0].delivery, { name: "수정 고객", address: "서울시 수정구 수정로 2", phone: "010-9999-8888" });
  assert.equal(state.customers[0].instagramId, "updated.case");
  assert.throws(() => editCustomer(state, customer.id, { name: "", address: "", phone: "123" }), /성명, 주소/);
});

test("shipping workbook rows import new customers and update matching IDs", () => {
  const records = parseCustomerWorkbookRows([
    [],
    ["받는분성명", "받는분 주소", "우편번호", "전화번호", "기타 연락처", "배송메세지", "품목명"],
    ["신규 고객", "서울시 신규구 1", "", "01011112222", "", "", "@new.case"],
    ["기존 고객 수정", "서울시 수정구 2", "", "", "01033334444", "", "same.case"],
  ]);
  let state = emptyState();
  state.customers = [{ id: "same", instagramId: "SAME.CASE", delivery: info(), updatedAt: "2026-01-01T00:00:00.000Z" }];
  const imported = importCustomers(state, records);
  assert.deepEqual(imported.summary, { created: 1, updated: 1, unchanged: 0, total: 2 });
  assert.equal(imported.state.customers.length, 2);
  assert.deepEqual(imported.state.customers.find((customer) => customer.id === "same")?.delivery, { name: "기존 고객 수정", address: "서울시 수정구 2", phone: "010-3333-4444" });
  assert.ok(imported.state.customers.some((customer) => customer.instagramId === "new.case"));
});

test("customer workbook import rejects missing fields and conflicting duplicate IDs", () => {
  assert.throws(() => parseCustomerWorkbookRows([["품목명", "받는분성명", "받는분 주소", "전화번호"], ["bad.case", "", "서울시", "01012345678"]]), /2행의 받는분 성명/);
  assert.throws(() => parseCustomerWorkbookRows([
    ["품목명", "받는분성명", "받는분 주소", "전화번호"],
    ["same.case", "고객", "서울시 1", "01012345678"],
    ["same.case", "고객", "서울시 2", "01012345678"],
  ]), /같은 인스타그램 ID/);
});

test("courier invoice workbook imports recipient columns U through Z from the first row", () => {
  const headers = [
    "No", "", "선택", "접수\n순서", "예약\n구분", "상태", "집화예정일자", "운송장번호", "집화예정점소", "보내는분",
    "보내는분전화번호", "운임\n구분", "박스\n타입", "수량", "내품수량", "기본운임", "기타운임", "운임합계", "고객주문번호", "배송계획점소",
    "받는분", "받는분전화번호", "받는분우편번호", "받는분주소", "상품코드", "상품명", "단품코드", "단품명", "배송메시지", "기타1",
    "기타2", "기타3", "기타4", "기타5", "기타6", "기타7", "기타8", "기타9", "기타10", "휴일배송",
  ];
  const row: unknown[] = Array.from({ length: 40 }, () => "");
  row[20] = "송장 고객";
  row[21] = 1012345678;
  row[22] = "01234";
  row[23] = "서울시 송장구 배송로 1";
  row[24] = "상품 코드";
  row[25] = "@invoice.case";
  const records = parseCustomerWorkbookRows([headers, row]);
  assert.deepEqual(records, [{
    instagramId: "invoice.case",
    delivery: { name: "송장 고객", address: "서울시 송장구 배송로 1", phone: "010-1234-5678" },
    row: 2,
  }]);
});

test("customer checks, blocking, and recent order time stay separate from order status", () => {
  let { state, broadcastId } = setup(["status.case"]);
  state.broadcasts[0].createdAt = "2026-08-28T20:14:00.000Z";
  state = registerOrder(state, broadcastId, `인스타 아이디: status.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const customer = state.customers[0];
  customer.legacyCheckCount = 2;
  assert.equal(customerCheckCount(customer), 2);
  assert.equal(customerStatusLabel(customer), "체크 2회");
  assert.equal(customerLastOrderedAt(state, customer), "2026-08-28T20:14:00.000Z");
  const orderStatus = state.broadcasts[0].orders[0].status;

  state = addCustomerCheck(state, customer.id, "2026-09-01", "연락 없이 미입금");
  const check = state.customers[0].checkHistory![0];
  assert.equal(customerStatusLabel(state.customers[0]), "체크 3회");
  state = editCustomerCheck(state, customer.id, check.id, "2026-09-02", "메모 수정");
  assert.deepEqual(state.customers[0].checkHistory![0], { id: check.id, date: "2026-09-02", note: "메모 수정" });
  state = setCustomerBlocked(state, customer.id, true);
  assert.equal(customerStatusLabel(state.customers[0]), "차단");
  assert.equal(state.broadcasts[0].orders[0].status, orderStatus);
  state = setCustomerBlocked(state, customer.id, false);
  assert.equal(customerStatusLabel(state.customers[0]), "체크 3회");
  state = deleteCustomerCheck(state, customer.id, check.id);
  assert.equal(customerStatusLabel(state.customers[0]), "체크 2회");
});

test("customer order history accumulates matching broadcast orders newest first", () => {
  let state = emptyState();
  const older = addBroadcast(state, "8월 방송"); state = older.state; state.broadcasts[0].createdAt = "2026-08-20T12:00:00.000Z";
  state = saveSettlement(state, older.broadcastId, "history.case - 1번 1.5");
  state = registerOrder(state, older.broadcastId, `인스타 아이디: history.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const newer = addBroadcast(state, "9월 방송"); state = newer.state; state.broadcasts[0].createdAt = "2026-09-01T12:00:00.000Z";
  state = saveSettlement(state, newer.broadcastId, "history.case - 2번 2.5");
  state = registerOrder(state, newer.broadcastId, `인스타 아이디: history.case\n성함: ${info().name}\n주소: ${info().address}\n연락처: ${info().phone}`).state;
  const customer = state.customers.find((item) => item.instagramId === "history.case")!;
  const history = customerOrderHistory(state, customer);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => item.broadcastTitle), ["9월 방송", "8월 방송"]);
  assert.deepEqual(history.map((item) => [item.quantity, item.total]), [[1, 25_000], [1, 15_000]]);
});

test("the exported XLSX can be read back into customer records", async () => {
  const bytes = createShippingWorkbook(
    ["받는분성명", "받는분 주소", "우편번호", "전화번호", "기타 연락처", "배송메세지", "품목명"],
    [["왕복 고객", "서울시 왕복구 3", "", "010-5555-6666", "010-5555-6666", "", "round.trip"]],
  );
  const sheets = await readXlsxFile(Buffer.from(bytes));
  const records = parseCustomerWorkbookRows(sheets[0].data);
  assert.deepEqual(records, [{ instagramId: "round.trip", delivery: { name: "왕복 고객", address: "서울시 왕복구 3", phone: "010-5555-6666" }, row: 3 }]);
});

test("broadcast deletion removes only the selected broadcast", () => {
  let state = emptyState();
  const first = addBroadcast(state, "첫 번째 방송"); state = first.state;
  const second = addBroadcast(state, "두 번째 방송"); state = second.state;
  state = deleteBroadcast(state, first.broadcastId);
  assert.deepEqual(state.broadcasts.map((broadcast) => broadcast.id), [second.broadcastId]);
});

test("repository reads and writes only the V2 mock namespace and rejects corrupt data", () => {
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const state = loadMockState(storage); assert.ok(isDashboardState(state)); assert.equal(state.broadcasts.length, 0); assert.equal(state.customers.length, 0); saveMockState(storage, state);
  assert.deepEqual([...values.keys()], [STORAGE_KEY]);
  values.set(STORAGE_KEY, JSON.stringify({ version: 2, broadcasts: "bad", customers: [] }));
  assert.throws(() => loadMockState(storage), /형식/);
});

test("legacy Supabase broadcasts and shipping rounds migrate once without overwriting local data", () => {
  const local = emptyState();
  local.customers.push({ id: "local-customer", instagramId: "same.case", delivery: info("999"), updatedAt: "2026-09-01T00:00:00.000Z" });
  const memos = [{
    id: "memo-1", title: "이전 방송", memo: "same.case - 1번 1.5\nwaiting.case - 2번 2.0", paidNicknames: [],
    createdAt: "2026-08-20T12:00:00.000Z", updatedAt: "2026-08-20T13:00:00.000Z",
  }];
  const shippingInfo = { name: "이전 고객", address: "서울시 이전구 1", zipCode: "", phone1: "01011112222", phone2: "", memo: "", items: "" };
  const rounds = [{
    id: "memo-memo-1", createdAt: memos[0].createdAt, updatedAt: memos[0].updatedAt,
    participants: [
      { instagramId: "same.case", status: "READY" as const, shippingInfo },
      { instagramId: "waiting.case", status: "WAITING" as const, shippingInfo: null },
    ],
  }];
  const first = mergeLegacyData(local, memos, rounds);
  assert.equal(first.importedBroadcasts, 1);
  assert.equal(first.state.broadcasts.length, 1);
  assert.equal(first.state.broadcasts[0].settlements.length, 2);
  assert.deepEqual(first.state.broadcasts[0].orders.map((order) => order.status), ["READY", "WAITING"]);
  assert.match(first.state.customers.find((customer) => customer.id === "local-customer")!.delivery.address, /999호/);
  const second = mergeLegacyData(first.state, memos, rounds);
  assert.equal(second.importedBroadcasts, 0);
  assert.equal(second.state.broadcasts.length, 1);
});

test("remote initialization keeps newer local records and remote-only records", () => {
  let remote = emptyState();
  const remoteOnly = addBroadcast(remote, "원격 방송"); remote = remoteOnly.state;
  remote.broadcasts[0].createdAt = "2026-09-01T00:00:00.000Z";
  remote.broadcasts[0].updatedAt = "2026-09-01T00:00:00.000Z";
  remote.customers = [{ id: "remote", instagramId: "same.case", delivery: info("100"), updatedAt: "2026-09-01T00:00:00.000Z", checkHistory: [{ id: "remote-check", date: null, note: "기존" }] }];

  let local = emptyState();
  const localOnly = addBroadcast(local, "로컬 방송"); local = localOnly.state;
  local.broadcasts[0].createdAt = "2026-09-02T00:00:00.000Z";
  local.broadcasts[0].updatedAt = "2026-09-02T00:00:00.000Z";
  local.customers = [{ id: "local", instagramId: "SAME.CASE", delivery: info("200"), updatedAt: "2026-09-02T00:00:00.000Z", checkHistory: [{ id: "local-check", date: "2026-09-02", note: "신규" }] }];

  const merged = mergeDashboardStates(remote, local);
  assert.deepEqual(new Set(merged.broadcasts.map((broadcast) => broadcast.title)), new Set(["원격 방송", "로컬 방송"]));
  assert.equal(merged.customers.length, 1);
  assert.match(merged.customers[0].delivery.address, /200호/);
  assert.deepEqual(new Set(merged.customers[0].checkHistory?.map((check) => check.id)), new Set(["remote-check", "local-check"]));
});

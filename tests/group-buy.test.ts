import test from "node:test";
import assert from "node:assert/strict";
import { cancelOrder, confirmPayments, deleteGroupBuy, readyItemsReport, restoreGroupBuy, setSoldOut, detectTrackingColumns, editOrderItems, exportReadyOrders, lookupOrders, matchTrackingRows, revertPayment, saveGroupBuy, stockReport, submitOrder, trackingRowsFrom } from "../app/group-buy/model";
import { createSeedState } from "../app/group-buy/mock";
import { priceCart } from "../app/group-buy/pricing";
import { remoteAreaOf } from "../app/group-buy/remote-area";
import { axisState, normalizeSelection, resolveOption, sizeRows } from "../app/group-buy/variants";
import type { CustomerInput, GroupBuy, GroupBuyState } from "../app/group-buy/types";

const NOW = new Date("2026-10-13T12:00:00+09:00");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function base(): { state: GroupBuyState; groupBuy: GroupBuy } {
  const groupBuy: GroupBuy = {
    id: "gb", slug: "test-gb", title: "테스트 공구", description: "", imageUrl: "", policyText: "", notices: "", checkoutNotice: "", completionNotice: "",
    opensAt: later(-60).toISOString(), closesAt: later(60 * 24).toISOString(),
    shippingFee: 3500, freeShippingThreshold: 50000, discountTiers: [{ minSubtotal: 100000, amount: 5000 }],
    bankName: "은행", bankAccount: "000-000", bankHolder: "테스트", paymentDueHours: 24, status: "open",
    products: [{ id: "p", name: "니트", summary: "", originalPrice: null, images: [], detailBlocks: [], axes: [], sizeChart: null, options: [{ id: "a", name: "A", price: 20000, stockQty: 3, orderedQty: 0, lowStockAlert: 1 }, { id: "b", name: "B", price: 6900, stockQty: null, orderedQty: 0, lowStockAlert: 5 }] }],
    createdAt: NOW.toISOString(),
  };
  return { state: { version: 1, groupBuys: [groupBuy], orders: [], stockLogs: [], orderSeq: 41, lookupLocks: {} }, groupBuy };
}

const customer = (extra: Partial<CustomerInput> = {}): CustomerInput => ({ customerName: "테스트", phone: "01012345678", recipientName: "테스트", recipientPhone: "010-1234-5678", postcode: "06236", address: "테스트시 가상구 1", addressDetail: "", shippingMessage: "", depositorName: "테스트", pin: "1234", ...extra });

function place(state: GroupBuyState, lines: { optionId: string; quantity: number }[], extra: Partial<CustomerInput> = {}, expectedTotal: number | null = null) {
  const result = submitOrder(state, { groupBuyId: "gb", lines, input: customer(extra), expectedTotal, source: "form" }, NOW);
  if (!result.ok) throw new Error(result.message);
  return result;
}

test("price = subtotal + shipping − tier discount, free shipping at threshold", () => {
  const { groupBuy } = base();
  assert.deepEqual(pick(priceCart(groupBuy, [{ optionId: "b", quantity: 2 }])), { subtotal: 13800, shippingFee: 3500, discount: 0, total: 17300 });
  assert.deepEqual(pick(priceCart(groupBuy, [{ optionId: "a", quantity: 3 }])), { subtotal: 60000, shippingFee: 0, discount: 0, total: 60000 });
  assert.deepEqual(pick(priceCart(groupBuy, [{ optionId: "a", quantity: 5 }])), { subtotal: 100000, shippingFee: 0, discount: 5000, total: 95000 });
  assert.equal(priceCart(groupBuy, []).total, 0);
});
const pick = ({ subtotal, shippingFee, discount, total }: ReturnType<typeof priceCart>) => ({ subtotal, shippingFee, discount, total });

test("submit stores snapshot prices, order number, hashed pin and decrements stock", () => {
  const { state } = base();
  const { state: next, order } = place(state, [{ optionId: "a", quantity: 2 }]);
  assert.match(order.orderNo, /^GB-\d{4}-0042$/);
  assert.equal(order.phone, "010-1234-5678");
  assert.notEqual(order.lookupPinHash, "1234");
  assert.equal(order.items[0].unitPrice, 20000);
  assert.equal(next.groupBuys[0].products[0].options[0].orderedQty, 2);
  assert.equal(next.stockLogs[0].change, -2);
});

test("over-stock orders go through; only confirmed sold-out options, closed group buys and price changes stop an order", () => {
  const { state } = base();
  // 재고(3)보다 많이 주문해도 받는다. 부족분은 추가 발주.
  const over = submitOrder(state, { groupBuyId: "gb", lines: [{ optionId: "a", quantity: 4 }], input: customer(), expectedTotal: null, source: "form" }, NOW);
  assert.equal(over.ok, true);
  const soldOut = setSoldOut(state, "gb", "a", true);
  const blocked = submitOrder(soldOut, { groupBuyId: "gb", lines: [{ optionId: "a", quantity: 1 }], input: customer(), expectedTotal: null, source: "form" }, NOW);
  assert.equal(!blocked.ok && blocked.code, "STOCK");
  const closed = submitOrder(state, { groupBuyId: "gb", lines: [{ optionId: "a", quantity: 1 }], input: customer(), expectedTotal: null, source: "form" }, later(60 * 25));
  assert.equal(!closed.ok && closed.code, "CLOSED");
  const changed = submitOrder(state, { groupBuyId: "gb", lines: [{ optionId: "a", quantity: 1 }], input: customer(), expectedTotal: 20000, source: "form" }, NOW);
  assert.equal(!changed.ok && changed.code, "PRICE_CHANGED");
  assert.equal(!changed.ok && changed.priced?.total, 23500);
  const manual = submitOrder(soldOut, { groupBuyId: "gb", lines: [{ optionId: "a", quantity: 4 }], input: customer(), expectedTotal: null, source: "manual", allowOverStock: true }, NOW);
  assert.equal(manual.ok, true);
});

test("stock shortage and ready-to-ship item totals show how much to reorder", () => {
  const { state } = base();
  // 재고 3개인 옵션 a에 2 + 2 + 1 = 5개 주문. 1건은 이미 출력, 2건은 출력 대기.
  let s = place(state, [{ optionId: "a", quantity: 2 }]).state;
  const first = s.orders[0].id;
  s = confirmPayments(s, [first], NOW);
  s = exportReadyOrders(s, "gb", () => undefined, NOW);
  s = place(s, [{ optionId: "a", quantity: 2 }]).state;
  s = place(s, [{ optionId: "a", quantity: 1 }, { optionId: "b", quantity: 1 }]).state;
  s = confirmPayments(s, s.orders.filter((o) => o.status === "WAITING").map((o) => o.id), NOW);
  const row = stockReport(s, s.groupBuys[0]).find((r) => r.optionId === "a")!;
  assert.equal(row.shortage, 2);
  assert.equal(row.level, "short");
  const ready = readyItemsReport(s, s.groupBuys[0]);
  const a = ready.find((r) => r.optionId === "a")!;
  // 이번에 보낼 3개 vs 재고 3 − 이미 보낸 2 = 1 → 2개 추가 발주
  assert.deepEqual({ readyQty: a.readyQty, orderCount: a.orderCount, available: a.available, shortage: a.shortage }, { readyQty: 3, orderCount: 2, available: 1, shortage: 2 });
  assert.equal(ready[0].optionId, "a");
});

test("price edits after an order do not change the stored order", () => {
  const { state } = base();
  const { state: next, order } = place(state, [{ optionId: "a", quantity: 1 }]);
  const draft = structuredClone(next.groupBuys[0]); draft.products[0].options[0].price = 99000;
  const saved = saveGroupBuy(next, draft);
  assert.equal(saved.orders[0].total, order.total);
  assert.equal(saved.groupBuys[0].products[0].options[0].orderedQty, 1);
});

test("cancel and item edits restore stock; status flow WAITING → READY → COMPLETED and back", () => {
  const { state } = base();
  let { state: s, order } = place(state, [{ optionId: "a", quantity: 2 }]);
  s = editOrderItems(s, order.id, [{ optionId: "a", quantity: 1 }, { optionId: "b", quantity: 1 }], false, NOW);
  assert.equal(s.groupBuys[0].products[0].options[0].orderedQty, 1);
  assert.equal(s.orders[0].total, 20000 + 6900 + 3500);
  s = confirmPayments(s, [order.id], NOW);
  assert.equal(s.orders[0].status, "READY");
  s = revertPayment(s, order.id, NOW);
  assert.equal(s.orders[0].status, "WAITING");
  s = confirmPayments(s, [order.id], NOW);
  let file = 0;
  s = exportReadyOrders(s, "gb", () => { file += 1; }, NOW);
  assert.equal(file, 1);
  assert.equal(s.orders[0].status, "COMPLETED");
  s = cancelOrder(s, order.id, "", NOW);
  assert.equal(s.groupBuys[0].products[0].options[0].orderedQty, 0);
  const report = stockReport(s, s.groupBuys[0]);
  assert.equal(report[0].remaining, 3);
});

test("lookup needs phone + pin, locks after 5 failures", () => {
  const { state } = base();
  let s = place(state, [{ optionId: "a", quantity: 1 }]).state;
  const ok = lookupOrders(s, "010 1234 5678", "1234", NOW);
  assert.equal(ok.result.ok, true);
  for (let i = 0; i < 5; i += 1) s = lookupOrders(s, "01012345678", "0000", NOW).state;
  const locked = lookupOrders(s, "01012345678", "1234", NOW);
  assert.equal(locked.result.ok, false);
  assert.ok(!locked.result.ok && locked.result.lockedUntil);
  assert.equal(lookupOrders(s, "01012345678", "1234", later(16)).result.ok, true);
});

test("tracking rows auto-match by recipient name + phone, ambiguous rows keep candidates", () => {
  const { state } = base();
  let s = place(state, [{ optionId: "b", quantity: 1 }], { customerName: "가나", recipientName: "가나", phone: "010-1111-2222", recipientPhone: "010-1111-2222" }).state;
  s = place(s, [{ optionId: "b", quantity: 1 }], { customerName: "다라", recipientName: "다라", phone: "010-3333-4444", recipientPhone: "010-3333-4444" }).state;
  s = place(s, [{ optionId: "b", quantity: 2 }], { customerName: "다라", recipientName: "다라", phone: "010-3333-4444", recipientPhone: "010-3333-4444" }).state;
  s = confirmPayments(s, s.orders.map((o) => o.id), NOW);
  s = exportReadyOrders(s, "gb", () => undefined, NOW);
  const rows = [["", "", ""], ["수하인명", "수하인전화번호", "운송장번호"], ["가나", "01011112222", "111"], ["다라", "010-3333-4444", "222"], ["없음", "010-9999-9999", "333"]];
  const detected = detectTrackingColumns(rows);
  assert.ok(detected);
  const matches = matchTrackingRows(s, "gb", trackingRowsFrom(rows, detected!.headerRow, detected!.columns, "CJ대한통운"));
  assert.deepEqual(matches.map((m) => m.candidates.length), [1, 2, 0]);
});

test("seed data is internally consistent", () => {
  const state = createSeedState(NOW);
  // 데모는 마약 팬츠 공구 하나만 남긴다.
  assert.deepEqual(state.groupBuys.map((g) => g.slug), ["pants"]);
  const pants = state.groupBuys[0];
  for (const option of pants.products.flatMap((p) => p.options)) {
    const ordered = state.orders.filter((o) => o.groupBuyId === pants.id && !o.cancelledAt).flatMap((o) => o.items).filter((i) => i.optionId === option.id).reduce((sum, i) => sum + i.quantity, 0);
    assert.equal(option.orderedQty, ordered, option.name);
  }
});

test("마약 팬츠: 16 combos, wide superlong forces L, slim forces black, 54,800원 example", () => {
  const state = createSeedState(NOW);
  const pants = state.groupBuys.find((g) => g.slug === "pants")!;
  const product = pants.products[0];
  assert.equal(product.options.length, 16);

  const wideSuper = normalizeSelection(product, { 종류: "와이드", 기장: "슈퍼롱" });
  assert.equal(wideSuper.selection.사이즈, "L");
  assert.equal(wideSuper.hints.사이즈, "와이드 슈퍼롱은 L 사이즈만 있어요");
  assert.deepEqual(axisState(product, 2, wideSuper.selection).values.map((v) => v.exists), [false, true]);
  assert.equal(wideSuper.selection.컬러, undefined);

  const slim = normalizeSelection(product, { 종류: "슬림", 기장: "롱", 사이즈: "L" });
  // 컬러는 고르는 순간 담기므로 슬림이어도 자동으로 고르지 않는다. 멜란지만 비활성화된다.
  assert.equal(slim.selection.컬러, undefined);
  assert.deepEqual(axisState(product, 3, slim.selection).values.map((v) => v.exists), [true, false]);
  assert.equal(resolveOption(product, { ...slim.selection, 컬러: "블랙" })?.name, "슬림 롱 L 블랙");

  // 종류를 바꾸면 존재하지 않게 된 뒤 선택은 정리된다 (와이드 … 멜란지 → 슬림으로 바꾸면 사이즈는 유지, 멜란지는 지워짐)
  const switched = normalizeSelection(product, { 종류: "슬림", 기장: "슈퍼롱", 사이즈: "L", 컬러: "멜란지" });
  assert.equal(switched.selection.사이즈, "L");
  assert.equal(switched.selection.컬러, undefined);

  assert.deepEqual(sizeRows(product.sizeChart!, { 종류: "와이드", 기장: "슈퍼롱" }).map((row) => row.key.사이즈), ["L"]);
  assert.deepEqual(sizeRows(product.sizeChart!, { 종류: "슬림", 기장: "숏" }).map((row) => row.values[0]), ["92", "93.5"]);

  const priced = priceCart(pants, [{ optionId: resolveOption(product, { 종류: "슬림", 기장: "롱", 사이즈: "L", 컬러: "블랙" })!.id, quantity: 1 }, { optionId: resolveOption(product, { 종류: "와이드", 기장: "숏", 사이즈: "FREE", 컬러: "멜란지" })!.id, quantity: 1 }]);
  assert.equal(priced.total, 54800);
  assert.deepEqual(priced.items.map((item) => item.itemName), ["슬림 롱 L 블랙", "와이드 숏 FREE 멜란지"]);
});

test("after picking 종류 every axis unlocks; a later pick clears values that no longer exist", () => {
  const product = createSeedState(NOW).groupBuys.find((g) => g.slug === "pants")!.products[0];
  assert.equal(axisState(product, 1, {}).locked, true);
  assert.equal(axisState(product, 2, { 종류: "와이드" }).locked, false);
  // 와이드에서 사이즈 FREE를 먼저 고르고 기장 슈퍼롱을 고르면 FREE는 L로 바뀐다
  const result = normalizeSelection(product, { 종류: "와이드", 사이즈: "FREE", 기장: "슈퍼롱" });
  assert.equal(result.selection.사이즈, "L");
  assert.equal(result.hints.사이즈, "와이드 슈퍼롱은 L 사이즈만 있어요");
  // 슬림·와이드 모두 컬러는 비어 있는 상태로 시작한다
  assert.equal(normalizeSelection(product, { 종류: "슬림" }).selection.컬러, undefined);
  assert.equal(normalizeSelection(product, { 종류: "와이드" }).selection.컬러, undefined);
});

test("제주·도서산간 postcodes switch the shipping fee; a missing postcode never blocks the order", () => {
  const { state, groupBuy } = base();
  const remote = { ...groupBuy, remoteShippingFee: 6000 };
  const lines = [{ optionId: "b", quantity: 1 }];
  assert.equal(remoteAreaOf("63309"), "jeju");
  assert.equal(remoteAreaOf("40240"), "island");
  assert.equal(remoteAreaOf("06236"), null);
  assert.equal(priceCart(remote, lines, "06236").shippingFee, 3500);
  assert.equal(priceCart(remote, lines, "63309").shippingFee, 6000);
  // 무료배송 기준을 넘겨도 제주·도서산간 차액은 받는다
  assert.equal(priceCart(remote, [{ optionId: "a", quantity: 3 }], "63309").shippingFee, 2500);
  // remoteShippingFee가 없으면 지역과 상관없이 기본 배송비
  assert.equal(priceCart(groupBuy, lines, "63309").shippingFee, 3500);

  const withRemote = { ...state, groupBuys: [remote] };
  const jeju = submitOrder(withRemote, { groupBuyId: "gb", lines, input: customer({ postcode: "63309" }), expectedTotal: 6900 + 6000, source: "form" }, NOW);
  assert.equal(jeju.ok && jeju.order.shippingFee, 6000);
  // 주소 검색이 안 돼 우편번호가 비어도 주문은 받고, 제주 주소면 글자로 판별한다
  const noPostcode = submitOrder(withRemote, { groupBuyId: "gb", lines, input: customer({ postcode: "", address: "제주특별자치도 제주시 1" }), expectedTotal: null, source: "form" }, NOW);
  assert.equal(noPostcode.ok && noPostcode.order.shippingFee, 6000);
});

test("deleting a group buy removes its orders and stock logs; restore brings them back", () => {
  const state = createSeedState(NOW);
  const target = state.groupBuys[0];
  const optionIds = new Set(target.products.flatMap((product) => product.options.map((option) => option.id)));
  const { state: after, removed } = deleteGroupBuy(state, target.id);
  assert.equal(after.groupBuys.some((item) => item.id === target.id), false);
  assert.equal(after.orders.some((order) => order.groupBuyId === target.id), false);
  assert.equal(after.stockLogs.some((log) => optionIds.has(log.optionId)), false);
  assert.equal(after.groupBuys.length, state.groupBuys.length - 1);
  const back = restoreGroupBuy(after, removed);
  assert.equal(back.groupBuys.length, state.groupBuys.length);
  assert.equal(back.orders.length, state.orders.length);
  assert.equal(back.stockLogs.length, state.stockLogs.length);
});

import { XLSX_HEADER } from "../dashboard-v2/model";
import { normalizePhoneNumber } from "../dashboard-v2/shipping-parser";
import { createShippingWorkbook, createWorkbook } from "../dashboard-v2/workbook";
import type { OrderStatus } from "../dashboard-v2/types";
import { findOption, priceCart, remainingStock, totalsFor, type PricedCart } from "./pricing";
import type { CartLine, CustomerInput, GbOrder, GbOrderEvent, GbOrderItem, GbStockLog, GroupBuy, GroupBuyState } from "./types";

// Prototype "server". In production these become Supabase RPCs: the customer
// site may call only getPublicGroupBuy / submitOrder / lookupOrders, and each
// runs in one transaction. Here every function is a pure state transition so
// the browser store can apply it atomically and tests can exercise it.

export const statusLabels: Record<OrderStatus, string> = { WAITING: "입금 전", READY: "출력 대기", COMPLETED: "출력 완료" };
export const groupBuyStatusLabels = { draft: "준비", open: "진행", closed: "마감" } as const;
export const COURIERS = ["CJ대한통운", "우체국택배", "한진택배", "롯데택배", "로젠택배"] as const;
const LOOKUP_MAX_FAILURES = 5;
const LOOKUP_LOCK_MINUTES = 15;
const LOOKUP_RETENTION_DAYS = 90;
const HOUR = 3_600_000;

const uid = () => crypto.randomUUID();
const iso = (now: Date) => now.toISOString();
export const normalizePhone = (value: string) => normalizePhoneNumber(value);
export const validPhone = (value: string) => /^010-\d{4}-\d{4}$/.test(normalizePhone(value));
const normalizeName = (value: string) => value.replace(/\s+/g, "");

export class GroupBuyError extends Error {
  constructor(public code: "INVALID" | "CLOSED" | "STOCK" | "NOT_FOUND" | "STATE", message: string) { super(message); }
}

/** 프로토타입용 동기 해시. 운영에서는 DB 함수에서 bcrypt(crypt) 등으로 저장한다. */
export function hashPin(phone: string, pin: string) {
  let hash = 0x811c9dc5;
  for (const char of `${normalizePhone(phone)}:${pin}:unclozet-gb`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function getGroupBuy(state: GroupBuyState, id: string) {
  const groupBuy = state.groupBuys.find((item) => item.id === id);
  if (!groupBuy) throw new GroupBuyError("NOT_FOUND", "공구를 찾을 수 없습니다.");
  return groupBuy;
}

export function groupBuyBySlug(state: GroupBuyState, slug: string) {
  return state.groupBuys.find((item) => item.slug === slug) ?? null;
}

export type Availability = { orderable: boolean; reason: "open" | "draft" | "not-open" | "closed" | "sold-out" };
export function availability(groupBuy: GroupBuy, now = new Date()): Availability {
  if (groupBuy.status === "draft") return { orderable: false, reason: "draft" };
  if (groupBuy.status === "closed" || now > new Date(groupBuy.closesAt)) return { orderable: false, reason: "closed" };
  if (now < new Date(groupBuy.opensAt)) return { orderable: false, reason: "not-open" };
  const options = groupBuy.products.flatMap((product) => product.options);
  if (options.length && options.every((option) => remainingStock(option) <= 0)) return { orderable: false, reason: "sold-out" };
  return { orderable: true, reason: "open" };
}

export function customerInputIssues(input: CustomerInput) {
  const issues: Partial<Record<keyof CustomerInput, string>> = {};
  if (!input.customerName.trim()) issues.customerName = "주문자명을 입력하세요.";
  if (!validPhone(input.phone)) issues.phone = "010으로 시작하는 휴대폰 번호를 입력하세요.";
  if (!input.recipientName.trim()) issues.recipientName = "받는 분 성함을 입력하세요.";
  if (!validPhone(input.recipientPhone)) issues.recipientPhone = "받는 분 연락처를 확인하세요.";
  if (!input.address.trim()) issues.address = "주소를 입력하세요.";
  if (!input.depositorName.trim()) issues.depositorName = "입금자명을 입력하세요.";
  if (!/^\d{4}$/.test(input.pin)) issues.pin = "숫자 4자리를 입력하세요.";
  return issues;
}

function event(fromStatus: OrderStatus | null, toStatus: OrderStatus | null, actor: GbOrderEvent["actor"], note: string, now: Date): GbOrderEvent {
  return { id: uid(), fromStatus, toStatus, actor, note, createdAt: iso(now) };
}

/** Applies option quantity deltas (positive = more ordered) and records them in the stock log. */
function applyStock(state: GroupBuyState, groupBuyId: string, deltas: Map<string, number>, reason: GbStockLog["reason"], orderId: string, now: Date): GroupBuyState {
  const changes = [...deltas].filter(([, delta]) => delta !== 0);
  if (!changes.length) return state;
  const logs: GbStockLog[] = changes.map(([optionId, delta]) => ({ id: uid(), optionId, change: -delta, reason, note: "", orderId, createdAt: iso(now) }));
  return {
    ...state,
    stockLogs: [...logs, ...state.stockLogs],
    groupBuys: state.groupBuys.map((groupBuy) => groupBuy.id !== groupBuyId ? groupBuy : {
      ...groupBuy,
      products: groupBuy.products.map((product) => ({ ...product, options: product.options.map((option) => deltas.has(option.id) ? { ...option, orderedQty: Math.max(0, option.orderedQty + deltas.get(option.id)!) } : option) })),
    }),
  };
}

function stockShortages(groupBuy: GroupBuy, deltas: Map<string, number>) {
  const shortages: string[] = [];
  for (const [optionId, delta] of deltas) {
    if (delta <= 0) continue;
    const found = findOption(groupBuy, optionId);
    if (!found) continue;
    const left = remainingStock(found.option);
    if (delta > left) shortages.push(`${found.product.name} ${found.option.name} (남은 ${left}개)`);
  }
  return shortages;
}

function nextOrderNo(state: GroupBuyState, now: Date) {
  const seq = state.orderSeq + 1;
  const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return { seq, orderNo: `GB-${mmdd}-${String(seq).padStart(4, "0")}` };
}

export type SubmitRequest = {
  groupBuyId: string;
  lines: CartLine[];
  input: CustomerInput;
  /** 고객 화면에 보였던 최종 입금액. 서버 계산과 다르면 PRICE_CHANGED로 다시 확인받는다. */
  expectedTotal: number | null;
  source: GbOrder["source"];
  /** 수기 등록에서 판매자가 한정 수량 초과를 허용한 경우 */
  allowOverStock?: boolean;
};
export type SubmitResult =
  | { ok: true; state: GroupBuyState; order: GbOrder }
  | { ok: false; code: "INVALID" | "CLOSED" | "STOCK" | "PRICE_CHANGED"; message: string; priced?: PricedCart };

export function submitOrder(state: GroupBuyState, request: SubmitRequest, now = new Date()): SubmitResult {
  const groupBuy = state.groupBuys.find((item) => item.id === request.groupBuyId);
  if (!groupBuy) return { ok: false, code: "CLOSED", message: "공구를 찾을 수 없습니다." };
  if (request.source === "form") {
    const open = availability(groupBuy, now);
    if (!open.orderable) return { ok: false, code: "CLOSED", message: { "sold-out": "모든 옵션이 품절되었습니다.", draft: "아직 준비 중인 공구라 주문할 수 없습니다. (미리보기)", "not-open": "아직 주문 시작 전입니다.", closed: "주문이 마감되었습니다.", open: "" }[open.reason] };
  }
  const input = { ...request.input, phone: normalizePhone(request.input.phone), recipientPhone: normalizePhone(request.input.recipientPhone) };
  const issues = Object.values(customerInputIssues(input));
  if (issues.length) return { ok: false, code: "INVALID", message: issues[0]! };
  // 우편번호 없이도(주소 검색 실패) 주문은 받는다. 이때 제주는 주소 글자로, 도서산간은 판매자가 차액으로 처리한다.
  const priced = priceCart(groupBuy, request.lines, input.postcode, input.address);
  if (!priced.items.length) return { ok: false, code: "INVALID", message: "상품을 1개 이상 담아주세요." };
  const deltas = new Map(priced.items.map((item) => [item.optionId, item.quantity]));
  const shortages = stockShortages(groupBuy, deltas);
  if (shortages.length && !request.allowOverStock) return { ok: false, code: "STOCK", message: `재고가 부족합니다: ${shortages.join(", ")}`, priced };
  if (request.expectedTotal != null && request.expectedTotal !== priced.total) return { ok: false, code: "PRICE_CHANGED", message: "가격 또는 배송비가 바뀌었습니다. 변경된 금액을 확인해 주세요.", priced };

  const { seq, orderNo } = nextOrderNo(state, now);
  const order: GbOrder = {
    id: uid(), orderNo, groupBuyId: groupBuy.id,
    customerName: input.customerName.trim(), phone: input.phone,
    recipientName: input.recipientName.trim(), recipientPhone: input.recipientPhone,
    postcode: input.postcode.trim(), address: input.address.trim(), addressDetail: input.addressDetail.trim(),
    shippingMessage: input.shippingMessage.trim(), depositorName: input.depositorName.trim(),
    lookupPinHash: hashPin(input.phone, input.pin), lookupToken: uid().replace(/-/g, ""),
    items: priced.items, subtotal: priced.subtotal, shippingFee: priced.shippingFee, discount: priced.discount, total: priced.total,
    status: "WAITING", sellerNote: "", courier: "", trackingNo: "", source: request.source,
    exportedAt: null, paidAt: null, trackingMatchedAt: null, cancelledAt: null, createdAt: iso(now),
    events: [event(null, "WAITING", request.source === "form" ? "customer" : "admin", request.source === "form" ? "주문서 제출" : shortages.length ? `수기 등록 (재고 초과 허용: ${shortages.join(", ")})` : "수기 등록", now)],
  };
  const next = applyStock({ ...state, orderSeq: seq, orders: [order, ...state.orders] }, groupBuy.id, deltas, "주문", order.id, now);
  return { ok: true, state: next, order };
}

// ── 고객 조회 ────────────────────────────────────────────

export type LookupResult = { ok: true; orders: GbOrder[] } | { ok: false; message: string; lockedUntil: string | null };

function lookupVisible(order: GbOrder, now: Date) {
  return !order.trackingMatchedAt || now.getTime() - new Date(order.trackingMatchedAt).getTime() < LOOKUP_RETENTION_DAYS * 24 * HOUR;
}

export function lookupOrders(state: GroupBuyState, phoneInput: string, pin: string, now = new Date()): { state: GroupBuyState; result: LookupResult } {
  const phone = normalizePhone(phoneInput);
  const lock = state.lookupLocks[phone] ?? { failures: 0, lockedUntil: null };
  if (lock.lockedUntil && new Date(lock.lockedUntil) > now) {
    return { state, result: { ok: false, message: `비밀번호를 ${LOOKUP_MAX_FAILURES}회 틀려 잠시 조회가 잠겼습니다.`, lockedUntil: lock.lockedUntil } };
  }
  const hash = hashPin(phone, pin);
  const orders = state.orders
    .filter((order) => order.phone === phone && order.lookupPinHash === hash && lookupVisible(order, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (orders.length) {
    const { [phone]: _cleared, ...rest } = state.lookupLocks;
    return { state: { ...state, lookupLocks: rest }, result: { ok: true, orders } };
  }
  // 번호가 없는 경우와 비밀번호가 틀린 경우를 구분하지 않는다(번호 존재 여부 노출 방지).
  const failures = (lock.lockedUntil ? 0 : lock.failures) + 1;
  const lockedUntil = failures >= LOOKUP_MAX_FAILURES ? iso(new Date(now.getTime() + LOOKUP_LOCK_MINUTES * 60_000)) : null;
  return {
    state: { ...state, lookupLocks: { ...state.lookupLocks, [phone]: { failures: lockedUntil ? 0 : failures, lockedUntil } } },
    result: { ok: false, message: lockedUntil ? `비밀번호를 ${LOOKUP_MAX_FAILURES}회 틀려 ${LOOKUP_LOCK_MINUTES}분간 조회가 잠겼습니다.` : `휴대폰 번호 또는 비밀번호가 맞지 않습니다. (${failures}/${LOOKUP_MAX_FAILURES})`, lockedUntil },
  };
}

export function orderByToken(state: GroupBuyState, token: string) {
  return state.orders.find((order) => order.lookupToken === token) ?? null;
}

export type CustomerStep = "received" | "paid" | "shipped" | "cancelled";
export function customerStep(order: GbOrder): CustomerStep {
  if (order.cancelledAt) return "cancelled";
  if (order.trackingNo) return "shipped";
  if (order.status === "WAITING") return "received";
  return "paid";
}

export const maskPhone = (phone: string) => phone.replace(/^(\d{3})-(\d{4})-(\d{4})$/, "$1-****-$3");
export const maskAddress = (address: string) => { const parts = address.trim().split(/\s+/); return parts.length > 2 ? `${parts.slice(0, 2).join(" ")} …` : address; };
export const maskName = (name: string) => name.length <= 1 ? name : name.length === 2 ? `${name[0]}*` : `${name[0]}${"*".repeat(name.length - 2)}${name.at(-1)}`;

export function trackingUrl(courier: string, trackingNo: string) {
  const no = encodeURIComponent(trackingNo.replace(/\D/g, ""));
  if (courier.includes("CJ")) return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${no}`;
  if (courier.includes("우체국")) return `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${no}`;
  if (courier.includes("한진")) return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${no}`;
  if (courier.includes("롯데")) return `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${no}`;
  if (courier.includes("로젠")) return `https://www.ilogen.com/web/personal/trace/${no}`;
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(`${courier} ${trackingNo}`)}`;
}

// ── 관리자: 주문 처리 ────────────────────────────────────

function mapOrder(state: GroupBuyState, orderId: string, change: (order: GbOrder) => GbOrder): GroupBuyState {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new GroupBuyError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  return { ...state, orders: state.orders.map((item) => item.id === orderId ? change(item) : item) };
}

export function paymentDueAt(order: GbOrder, groupBuy: GroupBuy) {
  return new Date(new Date(order.createdAt).getTime() + groupBuy.paymentDueHours * HOUR);
}
export function isOverdue(order: GbOrder, groupBuy: GroupBuy, now = new Date()) {
  return order.status === "WAITING" && !order.cancelledAt && now > paymentDueAt(order, groupBuy);
}

export function confirmPayments(state: GroupBuyState, orderIds: string[], now = new Date()) {
  const ids = new Set(orderIds);
  const targets = state.orders.filter((order) => ids.has(order.id) && order.status === "WAITING" && !order.cancelledAt);
  if (!targets.length) throw new GroupBuyError("STATE", "입금 확인할 주문이 없습니다.");
  const targetIds = new Set(targets.map((order) => order.id));
  return { ...state, orders: state.orders.map((order) => targetIds.has(order.id) ? { ...order, status: "READY" as const, paidAt: iso(now), events: [...order.events, event("WAITING", "READY", "admin", "입금 확인", now)] } : order) };
}

export function revertPayment(state: GroupBuyState, orderId: string, now = new Date()) {
  return mapOrder(state, orderId, (order) => {
    if (order.status !== "READY") throw new GroupBuyError("STATE", "출력 대기 주문만 입금 확인을 취소할 수 있습니다.");
    return { ...order, status: "WAITING", paidAt: null, events: [...order.events, event("READY", "WAITING", "admin", "입금 확인 취소", now)] };
  });
}

export function setSellerNote(state: GroupBuyState, orderId: string, note: string, now = new Date()) {
  return mapOrder(state, orderId, (order) => order.sellerNote === note.trim() ? order : { ...order, sellerNote: note.trim(), events: [...order.events, event(null, null, "admin", note.trim() ? `판매자 메모: ${note.trim()}` : "판매자 메모 삭제", now)] });
}

export function cancelOrder(state: GroupBuyState, orderId: string, reason: string, now = new Date()) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new GroupBuyError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (order.cancelledAt) throw new GroupBuyError("STATE", "이미 취소된 주문입니다.");
  const cancelled = mapOrder(state, orderId, (item) => ({ ...item, cancelledAt: iso(now), events: [...item.events, event(item.status, null, "admin", `주문 취소${reason.trim() ? `: ${reason.trim()}` : ""}`, now)] }));
  return applyStock(cancelled, order.groupBuyId, new Map(order.items.map((item) => [item.optionId, -item.quantity])), "취소", order.id, now);
}

/** 품목 수정. 기존 품목은 주문 당시 단가를 유지하고, 새로 추가한 옵션만 현재 단가를 쓴다. */
export function editOrderItems(state: GroupBuyState, orderId: string, lines: CartLine[], allowOverStock = false, now = new Date()) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new GroupBuyError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (order.cancelledAt || order.status === "COMPLETED") throw new GroupBuyError("STATE", "입금 전·출력 대기 주문만 품목을 수정할 수 있습니다.");
  const groupBuy = getGroupBuy(state, order.groupBuyId);
  const current = priceCart(groupBuy, lines);
  const items: GbOrderItem[] = current.items.map((item) => {
    const previous = order.items.find((old) => old.optionId === item.optionId);
    return previous ? { ...item, productName: previous.productName, optionName: previous.optionName, unitPrice: previous.unitPrice, lineTotal: previous.unitPrice * item.quantity } : item;
  });
  if (!items.length) throw new GroupBuyError("INVALID", "품목을 1개 이상 남겨주세요. 전체 취소는 주문 취소를 사용하세요.");
  const deltas = new Map<string, number>();
  for (const item of order.items) deltas.set(item.optionId, -item.quantity);
  for (const item of items) deltas.set(item.optionId, (deltas.get(item.optionId) ?? 0) + item.quantity);
  const shortages = stockShortages(groupBuy, deltas);
  if (shortages.length && !allowOverStock) throw new GroupBuyError("STOCK", `재고가 부족합니다: ${shortages.join(", ")}`);
  const totals = totalsFor(groupBuy, items, order.postcode, order.address);
  const summary = (list: GbOrderItem[]) => list.map((item) => `${item.optionName}×${item.quantity}`).join(", ");
  const edited = mapOrder(state, orderId, (item) => ({ ...item, items, subtotal: totals.subtotal, shippingFee: totals.shippingFee, discount: totals.discount, total: totals.total, events: [...item.events, event(null, null, "admin", `품목 수정: ${summary(order.items)} → ${summary(items)} (${order.total.toLocaleString()}원 → ${totals.total.toLocaleString()}원)`, now)] }));
  return applyStock(edited, order.groupBuyId, deltas, "품목 수정", order.id, now);
}

export type DeliveryFields = Pick<GbOrder, "customerName" | "phone" | "recipientName" | "recipientPhone" | "postcode" | "address" | "addressDetail" | "shippingMessage" | "depositorName">;
export function editOrderDelivery(state: GroupBuyState, orderId: string, fields: DeliveryFields, now = new Date()) {
  const normalized = { ...fields, phone: normalizePhone(fields.phone), recipientPhone: normalizePhone(fields.recipientPhone) };
  if (!validPhone(normalized.phone) || !validPhone(normalized.recipientPhone)) throw new GroupBuyError("INVALID", "010 형식의 휴대폰 번호를 입력하세요.");
  if (!normalized.recipientName.trim() || !normalized.address.trim()) throw new GroupBuyError("INVALID", "받는 분과 주소를 입력하세요.");
  return mapOrder(state, orderId, (order) => {
    const changed = (Object.keys(normalized) as (keyof DeliveryFields)[]).filter((key) => order[key] !== normalized[key]);
    if (!changed.length) return order;
    return { ...order, ...normalized, events: [...order.events, event(null, null, "admin", "주문자·배송 정보 수정", now)] };
  });
}

/** 조회 비밀번호는 휴대폰 번호 단위로 조회하므로 같은 번호의 모든 공구 주문에 함께 적용한다. */
export function resetLookupPin(state: GroupBuyState, orderId: string, pin: string, now = new Date()) {
  if (!/^\d{4}$/.test(pin)) throw new GroupBuyError("INVALID", "숫자 4자리를 입력하세요.");
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new GroupBuyError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  const hash = hashPin(order.phone, pin);
  const { [order.phone]: _cleared, ...locks } = state.lookupLocks;
  return { ...state, lookupLocks: locks, orders: state.orders.map((item) => item.phone === order.phone ? { ...item, lookupPinHash: hash, events: [...item.events, event(null, null, "admin", "조회 비밀번호 재설정", now)] } : item) };
}

export function setTracking(state: GroupBuyState, assignments: { orderId: string; courier: string; trackingNo: string }[], via: "excel" | "manual", now = new Date()) {
  const byId = new Map(assignments.map((item) => [item.orderId, item]));
  return {
    ...state,
    orders: state.orders.map((order) => {
      const assignment = byId.get(order.id);
      if (!assignment) return order;
      const trackingNo = assignment.trackingNo.trim();
      return { ...order, courier: trackingNo ? assignment.courier.trim() : "", trackingNo, trackingMatchedAt: trackingNo ? iso(now) : null, events: [...order.events, event(null, null, "admin", trackingNo ? `송장 ${via === "excel" ? "엑셀 매칭" : "직접 입력"}: ${assignment.courier} ${trackingNo}` : "송장번호 삭제", now)] };
    }),
  };
}

// ── 관리자: 택배 엑셀 ────────────────────────────────────

const itemLabel = (order: GbOrder) => order.items.map((item) => `${item.itemName ?? `${item.productName} ${item.optionName}`} × ${item.quantity}`).join(", ");
const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

function shippingRows(orders: GbOrder[]) {
  return orders.map((order) => [order.recipientName, `${order.address} ${order.addressDetail}`.trim(), order.postcode, order.recipientPhone, order.phone, order.shippingMessage, itemLabel(order)]);
}

/** 출력 대기 → 택배 엑셀(라이브방송과 같은 XLSX_HEADER) → 출력 완료 */
export function exportReadyOrders(state: GroupBuyState, groupBuyId: string, deliver: (bytes: Uint8Array, fileName: string) => void, now = new Date()) {
  const groupBuy = getGroupBuy(state, groupBuyId);
  const ready = state.orders.filter((order) => order.groupBuyId === groupBuyId && order.status === "READY" && !order.cancelledAt);
  if (!ready.length) throw new GroupBuyError("STATE", "출력 대기 주문이 없습니다.");
  deliver(createShippingWorkbook(XLSX_HEADER, shippingRows(ready)), `${safeFileName(groupBuy.title)}-택배-${ready.length}건.xlsx`);
  const ids = new Set(ready.map((order) => order.id));
  return { ...state, orders: state.orders.map((order) => ids.has(order.id) ? { ...order, status: "COMPLETED" as const, exportedAt: iso(now), events: [...order.events, event("READY", "COMPLETED", "admin", "택배 엑셀 출력", now)] } : order) };
}

/** 출력 완료 주문 재출력. 상태는 바뀌지 않는다. */
export function reexportOrders(state: GroupBuyState, groupBuyId: string, orderIds: string[], deliver: (bytes: Uint8Array, fileName: string) => void) {
  const groupBuy = getGroupBuy(state, groupBuyId);
  const ids = new Set(orderIds);
  const orders = state.orders.filter((order) => ids.has(order.id) && order.status === "COMPLETED" && !order.cancelledAt);
  if (!orders.length) throw new GroupBuyError("STATE", "재출력할 출력 완료 주문을 선택하세요.");
  deliver(createShippingWorkbook(XLSX_HEADER, shippingRows(orders)), `${safeFileName(groupBuy.title)}-택배-재출력-${orders.length}건.xlsx`);
  return state;
}

export type TrackingRow = { row: number; name: string; phone: string; trackingNo: string; courier: string };
export type TrackingMatch = TrackingRow & { candidates: string[] };

/** 송장 엑셀 행을 수령인명·전화번호로 출력 완료 주문과 맞춘다. 후보가 정확히 1개일 때만 자동 매칭. */
export function matchTrackingRows(state: GroupBuyState, groupBuyId: string, rows: TrackingRow[]): TrackingMatch[] {
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuyId && order.status === "COMPLETED" && !order.cancelledAt);
  return rows.map((row) => {
    const phone = normalizePhone(row.phone);
    const name = normalizeName(row.name);
    const both = orders.filter((order) => normalizeName(order.recipientName) === name && order.recipientPhone === phone);
    const candidates = both.length ? both : orders.filter((order) => (name && normalizeName(order.recipientName) === name) || (validPhone(phone) && order.recipientPhone === phone));
    // 같은 사람이 주문을 2건 이상 냈다면 아직 송장이 없는 주문을 먼저 후보로 둔다.
    const pending = candidates.filter((order) => !order.trackingNo);
    return { ...row, candidates: (both.length && pending.length ? pending : candidates).map((order) => order.id) };
  });
}

const headerAliases = {
  name: ["받는분성명", "받는분", "수령인", "수하인", "수취인", "받는사람", "고객명", "성명"],
  phone: ["받는분전화번호", "전화번호", "연락처", "휴대폰", "핸드폰", "수하인전화", "수령인연락처"],
  trackingNo: ["운송장번호", "송장번호", "운송장", "송장", "invoice"],
  courier: ["택배사", "배송사", "운송사"],
} as const;
export type TrackingColumns = { name: number; phone: number; trackingNo: number; courier: number | null };

/** 택배사마다 양식이 달라 헤더 이름으로 칼럼을 추측한다. 화면에서 직접 고칠 수 있다. */
export function detectTrackingColumns(rows: string[][]): { headerRow: number; columns: TrackingColumns } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    const cells = rows[r].map((cell) => String(cell ?? "").replace(/\s+/g, "").toLowerCase());
    const find = (aliases: readonly string[]) => { for (const alias of aliases) { const index = cells.findIndex((cell) => cell.includes(alias.toLowerCase())); if (index >= 0) return index; } return -1; };
    const trackingNo = find(headerAliases.trackingNo);
    const name = find(headerAliases.name);
    const phone = cells.findIndex((cell, index) => index !== name && headerAliases.phone.some((alias) => cell.includes(alias)));
    if (trackingNo >= 0 && name >= 0 && phone >= 0) {
      const courier = find(headerAliases.courier);
      return { headerRow: r, columns: { name, phone, trackingNo, courier: courier >= 0 ? courier : null } };
    }
  }
  return null;
}

export function trackingRowsFrom(rows: string[][], headerRow: number, columns: TrackingColumns, defaultCourier: string): TrackingRow[] {
  return rows.slice(headerRow + 1).map((cells, index) => ({
    row: headerRow + index + 2,
    name: String(cells[columns.name] ?? "").trim(),
    phone: String(cells[columns.phone] ?? "").trim(),
    trackingNo: String(cells[columns.trackingNo] ?? "").trim(),
    courier: (columns.courier != null ? String(cells[columns.courier] ?? "").trim() : "") || defaultCourier,
  })).filter((row) => row.trackingNo && (row.name || row.phone));
}

// ── 관리자: 재고·리포트 ──────────────────────────────────

export type StockRow = { productName: string; optionId: string; optionName: string; price: number; stockQty: number | null; waitingQty: number; paidQty: number; overdueQty: number; remaining: number; lowStockAlert: number; level: "unlimited" | "ok" | "low" | "out" };
export function stockReport(state: GroupBuyState, groupBuy: GroupBuy, now = new Date()): StockRow[] {
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuy.id && !order.cancelledAt);
  return groupBuy.products.flatMap((product) => product.options.map((option) => {
    const qty = (filter: (order: GbOrder) => boolean) => orders.filter(filter).reduce((sum, order) => sum + order.items.filter((item) => item.optionId === option.id).reduce((s, item) => s + item.quantity, 0), 0);
    const remaining = remainingStock(option);
    const level = option.stockQty == null ? "unlimited" : remaining <= 0 ? "out" : remaining <= option.lowStockAlert ? "low" : "ok";
    return { productName: product.name, optionId: option.id, optionName: option.name, price: option.price, stockQty: option.stockQty, waitingQty: qty((order) => order.status === "WAITING"), paidQty: qty((order) => order.status !== "WAITING"), overdueQty: qty((order) => isOverdue(order, groupBuy, now)), remaining, lowStockAlert: option.lowStockAlert, level };
  }));
}

export function adjustStock(state: GroupBuyState, groupBuyId: string, optionId: string, change: number, note: string, now = new Date()) {
  const groupBuy = getGroupBuy(state, groupBuyId);
  const found = findOption(groupBuy, optionId);
  if (!found) throw new GroupBuyError("NOT_FOUND", "옵션을 찾을 수 없습니다.");
  if (found.option.stockQty == null) throw new GroupBuyError("STATE", "재고를 관리하지 않는 옵션입니다. 설정에서 재고 수량을 먼저 입력하세요.");
  if (!Number.isInteger(change) || change === 0) throw new GroupBuyError("INVALID", "조정 수량을 입력하세요.");
  if (!note.trim()) throw new GroupBuyError("INVALID", "조정 사유를 남겨주세요.");
  const stockQty = found.option.stockQty + change;
  if (stockQty < 0) throw new GroupBuyError("INVALID", "전체 재고는 0보다 작을 수 없습니다.");
  return {
    ...state,
    stockLogs: [{ id: uid(), optionId, change, reason: "수동 조정" as const, note: note.trim(), orderId: null, createdAt: iso(now) }, ...state.stockLogs],
    groupBuys: state.groupBuys.map((item) => item.id !== groupBuyId ? item : { ...item, products: item.products.map((product) => ({ ...product, options: product.options.map((option) => option.id === optionId ? { ...option, stockQty } : option) })) }),
  };
}

export function groupBuySummary(state: GroupBuyState, groupBuy: GroupBuy) {
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuy.id && !order.cancelledAt);
  const lowStock = stockReport(state, groupBuy).filter((row) => row.level === "low" || row.level === "out").length;
  return { orders: orders.length, waiting: orders.filter((order) => order.status === "WAITING").length, revenue: orders.reduce((sum, order) => sum + order.total, 0), lowStock };
}

export function allOrdersWorkbook(state: GroupBuyState, groupBuyId: string) {
  const groupBuy = getGroupBuy(state, groupBuyId);
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuyId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const header = ["주문번호", "주문일시", "접수 경로", "상태", "주문자", "휴대폰", "입금자명", "받는 분", "받는 분 연락처", "우편번호", "주소", "배송 메시지", "품목", "상품 금액", "배송비", "할인", "최종 금액", "입금 확인 일시", "택배사", "송장번호", "판매자 메모"];
  const rows = orders.map((order) => [order.orderNo, order.createdAt, order.source === "form" ? "주문서" : "수기", order.cancelledAt ? "취소" : statusLabels[order.status], order.customerName, order.phone, order.depositorName, order.recipientName, order.recipientPhone, order.postcode, `${order.address} ${order.addressDetail}`.trim(), order.shippingMessage, itemLabel(order), order.subtotal, order.shippingFee, order.discount, order.total, order.paidAt ?? "", order.courier, order.trackingNo, order.sellerNote]);
  const stock = stockReport(state, groupBuy);
  const stockHeader = ["상품", "옵션", "단가", "전체 재고", "입금 전 수량", "입금 확인 수량", "주문 합계", "남은 재고"];
  const stockRows = stock.map((row) => [row.productName, row.optionName, row.price, row.stockQty ?? "무제한", row.waitingQty, row.paidQty, row.waitingQty + row.paidQty, row.stockQty == null ? "무제한" : row.remaining]);
  return {
    bytes: createWorkbook([{ name: "주문", rows: [header, ...rows] }, { name: "옵션별 집계", rows: [stockHeader, ...stockRows] }]),
    fileName: `${safeFileName(groupBuy.title)}-전체주문-${orders.length}건.xlsx`,
  };
}

// ── 관리자: 공구 설정 ────────────────────────────────────

/** 공구와 그 주문·재고 기록을 함께 지운다. 되돌리기용으로 지운 묶음을 돌려준다. */
export function deleteGroupBuy(state: GroupBuyState, groupBuyId: string) {
  const groupBuy = getGroupBuy(state, groupBuyId);
  const optionIds = new Set(groupBuy.products.flatMap((product) => product.options.map((option) => option.id)));
  const ours = (log: GbStockLog) => optionIds.has(log.optionId);
  const removed = { groupBuy, orders: state.orders.filter((order) => order.groupBuyId === groupBuyId), stockLogs: state.stockLogs.filter(ours) };
  return {
    state: { ...state, groupBuys: state.groupBuys.filter((item) => item.id !== groupBuyId), orders: state.orders.filter((order) => order.groupBuyId !== groupBuyId), stockLogs: state.stockLogs.filter((log) => !ours(log)) },
    removed,
  };
}

export function restoreGroupBuy(state: GroupBuyState, removed: ReturnType<typeof deleteGroupBuy>["removed"]): GroupBuyState {
  if (state.groupBuys.some((item) => item.id === removed.groupBuy.id)) return state;
  return { ...state, groupBuys: [...state.groupBuys, removed.groupBuy], orders: [...state.orders, ...removed.orders], stockLogs: [...state.stockLogs, ...removed.stockLogs] };
}


export function newGroupBuy(now = new Date()): GroupBuy {
  const close = new Date(now.getTime() + 7 * 24 * HOUR); close.setHours(23, 59, 0, 0);
  return {
    id: uid(), slug: `gb-${now.getMonth() + 1}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6)}`,
    title: "새 공구", description: "", imageUrl: "", policyText: DEFAULT_POLICY, notices: "", checkoutNotice: "", completionNotice: "", opensAt: iso(now), closesAt: iso(close),
    shippingFee: 3500, freeShippingThreshold: 50000, discountTiers: [],
    bankName: "", bankAccount: "", bankHolder: "", paymentDueHours: 24, status: "draft",
    products: [{ ...newProduct(), name: "상품 1", options: [{ id: uid(), name: "기본", price: 10000, stockQty: null, orderedQty: 0, lowStockAlert: 5 }] }],
    createdAt: iso(now),
  };
}

export function newProduct() {
  return { id: uid(), name: "", summary: "", originalPrice: null, images: [], detailBlocks: [], axes: [], sizeChart: null, options: [{ id: uid(), name: "기본", price: 10000, stockQty: null, orderedQty: 0, lowStockAlert: 5 }] };
}

export const DEFAULT_POLICY = "· 입금 확인 순서대로 공구 마감 후 3~5일 안에 발송합니다.\n· 단순 변심에 의한 교환·반품은 수령 후 7일 이내 가능하며 왕복 배송비는 고객 부담입니다.\n· 상품 하자는 사진과 함께 안부글로 남겨주시면 확인 후 교환해 드립니다.";

export function createGroupBuy(state: GroupBuyState, now = new Date()) {
  const groupBuy = newGroupBuy(now);
  return { state: { ...state, groupBuys: [groupBuy, ...state.groupBuys] }, groupBuyId: groupBuy.id };
}

export function duplicateGroupBuy(state: GroupBuyState, groupBuyId: string, now = new Date()) {
  const source = getGroupBuy(state, groupBuyId);
  const fresh = newGroupBuy(now);
  const groupBuy: GroupBuy = { ...source, id: fresh.id, slug: fresh.slug, title: `${source.title} (복제)`, status: "draft", opensAt: fresh.opensAt, closesAt: fresh.closesAt, createdAt: fresh.createdAt, products: source.products.map((product) => ({ ...product, id: uid(), detailBlocks: product.detailBlocks.map((block) => ({ ...block, id: uid() })), options: product.options.map((option) => ({ ...option, id: uid(), orderedQty: 0 })) })) };
  return { state: { ...state, groupBuys: [groupBuy, ...state.groupBuys] }, groupBuyId: groupBuy.id };
}

/** 설정 저장. 주문 수량(orderedQty)은 화면이 아니라 저장된 값을 유지하고, 주문이 있는 옵션은 삭제할 수 없다. */
export function saveGroupBuy(state: GroupBuyState, draft: GroupBuy) {
  const current = getGroupBuy(state, draft.id);
  const slug = draft.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new GroupBuyError("INVALID", "주소 슬러그는 영문 소문자·숫자·하이픈 2~41자로 입력하세요.");
  if (slug === "lookup" || slug === "order") throw new GroupBuyError("INVALID", "사용할 수 없는 슬러그입니다.");
  if (state.groupBuys.some((item) => item.id !== draft.id && item.slug === slug)) throw new GroupBuyError("INVALID", "이미 사용 중인 슬러그입니다.");
  if (!draft.title.trim()) throw new GroupBuyError("INVALID", "공구 제목을 입력하세요.");
  if (new Date(draft.closesAt) <= new Date(draft.opensAt)) throw new GroupBuyError("INVALID", "마감 일시는 시작 일시보다 늦어야 합니다.");
  if (!draft.products.length || draft.products.some((product) => !product.name.trim() || !product.options.length)) throw new GroupBuyError("INVALID", "상품마다 이름과 옵션을 1개 이상 입력하세요.");
  const options = draft.products.flatMap((product) => product.options);
  if (options.some((option) => !option.name.trim() || !Number.isFinite(option.price) || option.price < 0)) throw new GroupBuyError("INVALID", "옵션 이름과 0원 이상의 가격을 입력하세요.");
  if (options.some((option) => option.stockQty != null && (!Number.isInteger(option.stockQty) || option.stockQty < 0))) throw new GroupBuyError("INVALID", "재고 수량은 0 이상의 정수로 입력하세요.");
  if (draft.status === "open" && (!draft.bankName.trim() || !draft.bankAccount.trim() || !draft.bankHolder.trim())) throw new GroupBuyError("INVALID", "진행 상태로 바꾸려면 입금 계좌를 입력하세요.");
  const ordered = new Map(current.products.flatMap((product) => product.options).map((option) => [option.id, option.orderedQty]));
  const kept = new Set(options.map((option) => option.id));
  const usedOptionIds = new Set(state.orders.filter((order) => order.groupBuyId === draft.id && !order.cancelledAt).flatMap((order) => order.items.map((item) => item.optionId)));
  const removedInUse = [...usedOptionIds].filter((optionId) => !kept.has(optionId));
  if (removedInUse.length) throw new GroupBuyError("STATE", "주문이 들어온 옵션은 삭제할 수 없습니다. 재고를 0으로 두어 품절 처리하세요.");
  const groupBuy: GroupBuy = {
    ...draft, slug, title: draft.title.trim(),
    discountTiers: draft.discountTiers.filter((tier) => tier.minSubtotal > 0 && tier.amount > 0).sort((a, b) => a.minSubtotal - b.minSubtotal),
    products: draft.products.map((product) => ({ ...product, name: product.name.trim(), summary: product.summary.trim(), images: product.images.filter((url) => url.trim()), detailBlocks: product.detailBlocks.filter((block) => block.value.trim()), originalPrice: product.originalPrice && product.originalPrice > 0 ? product.originalPrice : null, options: product.options.map((option) => ({ ...option, name: option.name.trim(), orderedQty: ordered.get(option.id) ?? 0 })) })),
  };
  return { ...state, groupBuys: state.groupBuys.map((item) => item.id === groupBuy.id ? groupBuy : item) };
}

// ── 안내 문구 ────────────────────────────────────────────

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export function paymentGuideText(order: GbOrder, groupBuy: GroupBuy, lookupUrl: string) {
  return [
    `[${groupBuy.title}] 주문 접수 안내`,
    `주문번호 ${order.orderNo}`,
    ...order.items.map((item) => `· ${item.productName} ${item.optionName} × ${item.quantity}`),
    `입금하실 금액: ${won(order.total)}`,
    `입금 계좌: ${groupBuy.bankName} ${groupBuy.bankAccount} (${groupBuy.bankHolder})`,
    `입금자명: ${order.depositorName}`,
    `조회: ${lookupUrl} (비밀번호: 휴대폰 뒷 4자리)`,
  ].join("\n");
}

export function differenceSmsText(order: GbOrder, groupBuy: GroupBuy, lookupUrl: string) {
  return [
    `[${groupBuy.title}] ${order.customerName}님, 주문 ${order.orderNo} 입금 금액 확인 부탁드립니다.`,
    order.sellerNote || `결제 금액은 ${won(order.total)}입니다.`,
    `입금 계좌: ${groupBuy.bankName} ${groupBuy.bankAccount} (${groupBuy.bankHolder})`,
    `주문 조회: ${lookupUrl}`,
  ].join("\n");
}

export function smsHref(phone: string, body: string) {
  return `sms:${phone.replace(/\D/g, "")}?body=${encodeURIComponent(body)}`;
}

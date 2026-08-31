import { analyzeSettlement, itemLabel } from "./settlement";
import { canonicalInstagramId, normalizePhoneNumber, parseKakaoOrder } from "./shipping-parser";
import { createShippingWorkbook } from "./workbook";
import type { Broadcast, Customer, DashboardState, Delivery, Issue, Order } from "./types";

export const statusLabels = { WAITING: "입금 전", READY: "출력 대기", COMPLETED: "출력 완료" };
export const emptyDelivery = (): Delivery => ({ name: "", address: "", phone: "" });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const sameId = (a: string, b: string) => canonicalInstagramId(a) === canonicalInstagramId(b);
const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");

export function normalizedDelivery(delivery: Delivery): Delivery {
  return { name: normalizeText(delivery.name), address: normalizeText(delivery.address), phone: normalizePhoneNumber(delivery.phone) };
}

export function sameDelivery(a: Delivery, b: Delivery) {
  const left = normalizedDelivery(a);
  const right = normalizedDelivery(b);
  return left.name === right.name && left.address === right.address && left.phone === right.phone;
}

export function deliveryIssues(delivery: Delivery | null): Issue[] {
  if (!delivery) return [{ code: "NO_DELIVERY", message: "주문서 미등록" }];
  const issues: Issue[] = [];
  const leakedLabel = /^(?:인스타그램?\s*아이디|인스타|instagram\s*id|아이디|id|성함|이름|주소|전화번호|연락처|휴대폰|핸드폰)\s*[:：=]/i;
  if (!delivery.name.trim() || leakedLabel.test(delivery.name.trim())) issues.push({ code: "NAME", message: "받는분 성명 누락" });
  if (!delivery.address.trim() || leakedLabel.test(delivery.address.trim())) issues.push({ code: "ADDRESS", message: "주소 누락" });
  if (!/^010-\d{4}-\d{4}$/.test(normalizePhoneNumber(delivery.phone))) issues.push({ code: "PHONE", message: "연락처 형식 확인" });
  return issues;
}

export function orderIssues(broadcast: Broadcast, order: Order): Issue[] {
  const issues = deliveryIssues(order.delivery);
  if (!order.settlementId || !broadcast.settlements.some((s) => s.id === order.settlementId)) {
    issues.push({ code: "MATCH", message: "정산 주문 미연결" });
  }
  if (order.conflict) issues.push({ code: "CONFLICT", message: "기존 고객정보와 다름" });
  for (const message of order.extractionWarnings) issues.push({ code: "EXTRACTION", message });
  return issues;
}

function refreshStatus(broadcast: Broadcast, order: Order): Order {
  if (order.status === "COMPLETED") return order;
  return { ...order, status: order.registrationConfirmed && orderIssues(broadcast, order).length === 0 ? "READY" : "WAITING" };
}

export function customerFor(state: DashboardState, instagramId: string) {
  return state.customers.find((customer) => sameId(customer.instagramId, instagramId));
}

function updateCustomer(state: DashboardState, instagramId: string, delivery: Delivery): Customer[] {
  const customer = customerFor(state, instagramId);
  if (customer) return state.customers.map((c) => c.id === customer.id ? { ...c, delivery: { ...delivery }, updatedAt: now() } : c);
  return [{ id: id(), instagramId, delivery: { ...delivery }, updatedAt: now() }, ...state.customers];
}

function replaceBroadcast(state: DashboardState, broadcast: Broadcast): DashboardState {
  return { ...state, broadcasts: state.broadcasts.map((b) => b.id === broadcast.id ? { ...broadcast, updatedAt: now() } : b) };
}

function getBroadcast(state: DashboardState, broadcastId: string) {
  const broadcast = state.broadcasts.find((b) => b.id === broadcastId);
  if (!broadcast) throw new Error("방송 작업을 찾을 수 없습니다.");
  return broadcast;
}

export function addBroadcast(state: DashboardState, title: string): { state: DashboardState; broadcastId: string } {
  const broadcast: Broadcast = { id: id(), title: title.trim() || "새 방송 작업", memo: "", memoDraft: "", orderDraft: "", settlements: [], settlementErrors: [], orders: [], createdAt: now(), updatedAt: now() };
  return { state: { ...state, broadcasts: [broadcast, ...state.broadcasts] }, broadcastId: broadcast.id };
}

export function renameBroadcast(state: DashboardState, broadcastId: string, title: string) {
  if (!title.trim()) throw new Error("방송 이름을 입력하세요.");
  return replaceBroadcast(state, { ...getBroadcast(state, broadcastId), title: title.trim() });
}

export function deleteBroadcast(state: DashboardState, broadcastId: string) {
  if (!state.broadcasts.some((broadcast) => broadcast.id === broadcastId)) throw new Error("삭제할 방송을 찾을 수 없습니다.");
  return { ...state, broadcasts: state.broadcasts.filter((broadcast) => broadcast.id !== broadcastId) };
}

export function saveDraft(state: DashboardState, broadcastId: string, field: "memoDraft" | "orderDraft", value: string) {
  return replaceBroadcast(state, { ...getBroadcast(state, broadcastId), [field]: value });
}

export function saveSettlement(state: DashboardState, broadcastId: string, memo: string) {
  const old = getBroadcast(state, broadcastId);
  const result = analyzeSettlement(memo);
  const settlements = result.buyers.map((buyer) => ({
    id: old.settlements.find((s) => sameId(s.instagramId, buyer.nickname))?.id ?? id(),
    instagramId: buyer.nickname.replace(/^@/, ""), quantity: buyer.quantity, total: buyer.total, items: buyer.items.map(itemLabel),
  }));
  const next: Broadcast = { ...old, memo, memoDraft: memo, settlements, settlementErrors: result.errors, orders: [] };
  // Keep received and historical orders even if their settlement line disappears.
  // They become unlinked instead of silently losing shipping information.
  next.orders = old.orders.map((order) => {
    const settlement = settlements.find((s) => s.id === order.settlementId);
    return { ...order, settlementId: settlement?.id ?? null };
  }).filter((order) => order.settlementId || order.delivery || order.sourceText || order.status === "COMPLETED");
  for (const settlement of settlements) {
    const customer = customerFor(state, settlement.instagramId);
    const existingIndex = next.orders.findIndex((order) => order.settlementId === settlement.id);
    if (existingIndex >= 0) {
      const existing = next.orders[existingIndex];
      if (!existing.delivery && !existing.sourceText && existing.status === "WAITING" && customer) {
        next.orders[existingIndex] = { ...existing, instagramId: settlement.instagramId, delivery: { ...customer.delivery }, registrationConfirmed: false };
      }
      continue;
    }
    next.orders.push({ id: id(), instagramId: settlement.instagramId, settlementId: settlement.id, delivery: customer ? { ...customer.delivery } : null, status: "WAITING", registrationConfirmed: false, sourceText: "", extractionWarnings: [], conflict: null });
  }
  next.orders = next.orders.map((order) => refreshStatus(next, order));
  return replaceBroadcast(state, next);
}

export function registerOrder(state: DashboardState, broadcastId: string, text: string) {
  if (!text.trim()) throw new Error("주문서 내용을 입력하세요.");
  const broadcast = getBroadcast(state, broadcastId);
  // Parse independently so a typo is never replaced with the first similar ID.
  const parsed = parseKakaoOrder(text, []);
  const instagramId = parsed.instagramId.replace(/^@/, "");
  const settlement = broadcast.settlements.find((s) => sameId(s.instagramId, instagramId));
  const existing = settlement ? broadcast.orders.find((o) => o.settlementId === settlement.id) : undefined;
  if (existing?.status === "COMPLETED") throw new Error("완료된 주문은 출력 대기로 되돌린 후 수정하세요.");
  if (existing?.sourceText && sameDelivery(existing.delivery ?? emptyDelivery(), {
    name: parsed.shippingInfo.name, address: parsed.shippingInfo.address, phone: parsed.shippingInfo.phone1,
  }) && !existing.conflict) return { state, orderId: existing.id };
  const delivery = normalizedDelivery({ name: parsed.shippingInfo.name, address: parsed.shippingInfo.address, phone: parsed.shippingInfo.phone1 });
  const customer = customerFor(state, instagramId);
  const phones = new Set((text.match(/(?<!\d)010[\s.-]*\d{4}[\s.-]*\d{4}(?!\d)/g) ?? []).map(normalizePhoneNumber));
  const order: Order = {
    id: existing?.id ?? id(), instagramId, settlementId: settlement?.id ?? null, delivery,
    status: "WAITING", registrationConfirmed: true, sourceText: text,
    extractionWarnings: phones.size > 1 ? ["연락처가 여러 개 추출되었습니다. 정보 수정에서 확인하세요."] : [],
    conflict: customer && !sameDelivery(customer.delivery, delivery) ? { previous: { ...customer.delivery }, incoming: { ...delivery }, customerId: customer.id } : null,
  };
  const nextOrder = refreshStatus(broadcast, order);
  const next = replaceBroadcast(state, { ...broadcast, orders: existing ? broadcast.orders.map((o) => o.id === existing.id ? nextOrder : o) : [...broadcast.orders, nextOrder] });
  return { state: nextOrder.status === "READY" ? { ...next, customers: updateCustomer(next, instagramId, delivery) } : next, orderId: order.id };
}

export function confirmPreviousInfo(state: DashboardState, broadcastId: string, orderId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "WAITING" || order.registrationConfirmed) throw new Error("확인 가능한 과거 배송정보가 없습니다.");
  if (orderIssues(broadcast, order).length) throw new Error("필수 정보와 연결 문제를 먼저 수정하세요.");
  const next = { ...order, registrationConfirmed: true, status: "READY" as const };
  return replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? next : o) });
}

export function editOrder(state: DashboardState, broadcastId: string, orderId: string, delivery: Delivery, draftInstagramId = "") {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status === "COMPLETED") throw new Error("완료 주문은 출력 대기로 되돌린 후 수정하세요.");
  const instagramId = canonicalInstagramId(draftInstagramId || order.instagramId);
  if (!instagramId) throw new Error("인스타그램 아이디를 입력하세요.");
  const normalized = normalizedDelivery(delivery);
  const customer = customerFor(state, instagramId);
  const idChanged = !sameId(order.instagramId, instagramId);
  const conflict = idChanged
    ? customer && !sameDelivery(customer.delivery, normalized) ? { previous: { ...customer.delivery }, incoming: normalized, customerId: customer.id } : null
    : order.conflict && !sameDelivery(order.conflict.previous, normalized) ? { ...order.conflict, incoming: normalized } : null;
  const edited = { ...order, instagramId, delivery: normalized, extractionWarnings: [], registrationConfirmed: true, conflict };
  const refreshed = refreshStatus(broadcast, edited);
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? refreshed : o) });
  return refreshed.status === "READY" ? { ...next, customers: updateCustomer(next, instagramId, normalized) } : next;
}

export function resolveConflict(state: DashboardState, broadcastId: string, orderId: string, choice: "previous" | "incoming") {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order?.conflict || order.status === "COMPLETED") throw new Error("비교할 고객정보가 없습니다.");
  const delivery = normalizedDelivery(order.conflict[choice]);
  if (deliveryIssues(delivery).length) throw new Error("선택한 정보에 누락 또는 연락처 오류가 있습니다. 먼저 수정하세요.");
  const nextOrder = refreshStatus(broadcast, { ...order, delivery, conflict: null, registrationConfirmed: true });
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? nextOrder : o) });
  return { ...next, customers: updateCustomer(next, order.instagramId, delivery) };
}

export function matchOrder(state: DashboardState, broadcastId: string, orderId: string, settlementId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  const settlement = broadcast.settlements.find((s) => s.id === settlementId);
  if (!order || !settlement || order.status === "COMPLETED") throw new Error("연결할 주문을 확인하세요.");
  const occupied = broadcast.orders.find((o) => o.settlementId === settlementId && o.id !== orderId);
  if (occupied && (occupied.registrationConfirmed || occupied.status !== "WAITING")) throw new Error("이미 주문서가 등록된 정산 주문입니다.");
  const customer = customerFor(state, settlement.instagramId);
  const matched = { ...order, instagramId: settlement.instagramId, settlementId,
    conflict: customer && order.delivery && !sameDelivery(customer.delivery, order.delivery) ? { previous: { ...customer.delivery }, incoming: { ...order.delivery }, customerId: customer.id } : null };
  const nextOrder = refreshStatus(broadcast, matched);
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.filter((o) => o.id !== occupied?.id).map((o) => o.id === orderId ? nextOrder : o) });
  return nextOrder.status === "READY" && nextOrder.delivery ? { ...next, customers: updateCustomer(next, nextOrder.instagramId, nextOrder.delivery) } : next;
}

function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

export function matchingCandidates(broadcast: Broadcast, order: Order) {
  const key = canonicalInstagramId(order.instagramId);
  if (!key) return [];
  return broadcast.settlements.filter((s) => distance(key, canonicalInstagramId(s.instagramId)) <= 2)
    .sort((a, b) => distance(key, canonicalInstagramId(a.instagramId)) - distance(key, canonicalInstagramId(b.instagramId)));
}

export function restoreOrder(state: DashboardState, broadcastId: string, orderId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "COMPLETED") throw new Error("완료 주문이 아닙니다.");
  if (orderIssues(broadcast, order).length) throw new Error("배송정보 또는 정산 연결을 먼저 복구하세요.");
  return replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? { ...o, status: "READY" } : o) });
}

export const XLSX_HEADER = ["받는분성명", "받는분 주소", "우편번호", "전화번호", "기타 연락처", "배송메세지", "품목명"];

export function exportReadyOrders(state: DashboardState, broadcastId: string, deliver: (bytes: Uint8Array, fileName: string) => void) {
  const broadcast = getBroadcast(state, broadcastId);
  const ready = broadcast.orders.filter((o) => o.status === "READY");
  if (!ready.length) throw new Error("출력 대기 주문이 없습니다.");
  const invalid = ready.filter((order) => orderIssues(broadcast, order).length);
  if (invalid.length) throw new Error(`엑셀 생성 중단: ${invalid.map((o) => o.instagramId || "아이디 없음").join(", ")} 주문을 수정하세요.`);
  const rows = ready.map((order) => {
    const info = normalizedDelivery(order.delivery!);
    return [info.name, info.address, "", info.phone, info.phone, "", order.instagramId];
  });
  const bytes = createShippingWorkbook(XLSX_HEADER, rows);
  const safeTitle = broadcast.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  // State transitions happen only after generation and the download adapter
  // return successfully. Browsers cannot confirm an OS-level save to disk.
  deliver(bytes, `${safeTitle}-${ready.length}건.xlsx`);
  const exportedIds = new Set(ready.map((o) => o.id));
  return replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((order) => exportedIds.has(order.id) ? { ...order, status: "COMPLETED" } : order) });
}

export function editCustomer(state: DashboardState, customerId: string, delivery: Delivery, draftInstagramId = "") {
  const normalized = normalizedDelivery(delivery);
  if (deliveryIssues(normalized).length) throw new Error("성명, 주소와 010 형식의 연락처를 입력하세요.");
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) throw new Error("고객 정보를 찾을 수 없습니다.");
  const instagramId = canonicalInstagramId(draftInstagramId || customer.instagramId);
  if (!instagramId) throw new Error("인스타그램 아이디를 입력하세요.");
  if (state.customers.some((item) => item.id !== customerId && sameId(item.instagramId, instagramId))) throw new Error("이미 저장된 인스타그램 아이디입니다.");
  return { ...state, customers: state.customers.map((item) => item.id === customerId ? { ...item, instagramId, delivery: normalized, updatedAt: now() } : item) };
}

export function deleteCustomer(state: DashboardState, customerId: string) {
  return { ...state, customers: state.customers.filter((c) => c.id !== customerId) };
}

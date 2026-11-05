import { analyzeSettlement, itemLabel } from "./settlement";
import { canonicalInstagramId, normalizePhoneNumber, parseKakaoOrder } from "./shipping-parser";
import { createShippingWorkbook } from "./workbook";
import type { Broadcast, Customer, CustomerCheck, CustomerImportRecord, CustomerImportSummary, DashboardState, Delivery, Issue, Order } from "./types";

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

/** 이 고객의 모든 아이디(대표 + 합쳐진 아이디). */
export const customerIds = (customer: Customer) => [customer.instagramId, ...(customer.mergedCustomers ?? []).map((merged) => merged.instagramId)].map(canonicalInstagramId);

export function customerFor(state: DashboardState, instagramId: string) {
  const key = canonicalInstagramId(instagramId);
  return state.customers.find((customer) => customerIds(customer).includes(key));
}

/** 아이디만 저장된 고객(주문서 없이 체크·차단만 해둔 경우)인지. */
export const hasSavedDelivery = (customer: Customer) => Boolean(customer.delivery.name.trim() || customer.delivery.address.trim() || customer.delivery.phone.trim());

/** 배송정보를 채우거나 비교할 때 쓰는 고객. 아이디만 있는 고객은 비교할 정보가 없으므로 없는 것으로 본다. */
function savedCustomerFor(state: DashboardState, instagramId: string) {
  const customer = customerFor(state, instagramId);
  return customer && hasSavedDelivery(customer) ? customer : undefined;
}

function updateCustomer(state: DashboardState, instagramId: string, delivery: Delivery, orderedAt?: string): Customer[] {
  const customer = customerFor(state, instagramId);
  if (customer) return state.customers.map((c) => c.id === customer.id ? { ...c, delivery: { ...delivery }, updatedAt: now(), lastOrderedAt: [c.lastOrderedAt, orderedAt].filter((value): value is string => Boolean(value)).sort().at(-1) } : c);
  return [{ id: id(), instagramId, delivery: { ...delivery }, updatedAt: now(), lastOrderedAt: orderedAt, blocked: false, legacyCheckCount: 0, checkHistory: [] }, ...state.customers];
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
  const relinked = new Set<string>();
  for (const settlement of settlements) {
    const customer = savedCustomerFor(state, settlement.instagramId);
    const existingIndex = next.orders.findIndex((order) => order.settlementId === settlement.id);
    if (existingIndex >= 0) {
      const existing = next.orders[existingIndex];
      if (!existing.delivery && !existing.sourceText && existing.status === "WAITING" && customer) {
        next.orders[existingIndex] = { ...existing, instagramId: settlement.instagramId, delivery: { ...customer.delivery }, registrationConfirmed: false };
      }
      continue;
    }
    // 정산 줄이 없어서 연결되지 못했던 주문서(같은 아이디)는 정산 줄이 생기면 그 주문에 바로 잇는다.
    const orphanIndex = next.orders.findIndex((order) => !order.settlementId && order.status !== "COMPLETED" && sameId(order.instagramId, settlement.instagramId));
    if (orphanIndex >= 0) { next.orders[orphanIndex] = { ...next.orders[orphanIndex], settlementId: settlement.id }; relinked.add(next.orders[orphanIndex].id); continue; }
    next.orders.push({ id: id(), instagramId: settlement.instagramId, settlementId: settlement.id, delivery: customer ? { ...customer.delivery } : null, shippingMessage: "", status: "WAITING", registrationConfirmed: false, sourceText: "", extractionWarnings: [], conflict: null });
  }
  next.orders = next.orders.map((order) => refreshStatus(next, order));
  let saved = replaceBroadcast(state, next);
  // 다시 이어져 출력 대기가 된 주문서는 주문서 등록 때처럼 고객 정보도 저장한다.
  for (const order of next.orders) if (relinked.has(order.id) && order.status === "READY" && order.delivery) saved = { ...saved, customers: updateCustomer(saved, order.instagramId, order.delivery, next.createdAt) };
  return saved;
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
  }) && (existing.shippingMessage ?? "") === parsed.shippingInfo.memo && !existing.conflict) return { state, orderId: existing.id };
  const delivery = normalizedDelivery({ name: parsed.shippingInfo.name, address: parsed.shippingInfo.address, phone: parsed.shippingInfo.phone1 });
  const customer = savedCustomerFor(state, instagramId);
  const phones = new Set((text.match(/(?<!\d)010[\s.-]*\d{4}[\s.-]*\d{4}(?!\d)/g) ?? []).map(normalizePhoneNumber));
  const order: Order = {
    id: existing?.id ?? id(), instagramId, settlementId: settlement?.id ?? null, delivery, shippingMessage: parsed.shippingInfo.memo,
    status: "WAITING", registrationConfirmed: true, sourceText: text,
    extractionWarnings: phones.size > 1 ? ["연락처가 여러 개 추출되었습니다. 정보 수정에서 확인하세요."] : [],
    conflict: customer && !sameDelivery(customer.delivery, delivery) ? { previous: { ...customer.delivery }, incoming: { ...delivery }, customerId: customer.id } : null,
  };
  const nextOrder = refreshStatus(broadcast, order);
  const next = replaceBroadcast(state, { ...broadcast, orders: existing ? broadcast.orders.map((o) => o.id === existing.id ? nextOrder : o) : [...broadcast.orders, nextOrder] });
  return { state: nextOrder.status === "READY" ? { ...next, customers: updateCustomer(next, instagramId, delivery, broadcast.createdAt) } : next, orderId: order.id };
}

export function confirmPreviousInfo(state: DashboardState, broadcastId: string, orderId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "WAITING" || order.registrationConfirmed) throw new Error("확인 가능한 과거 배송정보가 없습니다.");
  if (orderIssues(broadcast, order).length) throw new Error("필수 정보와 연결 문제를 먼저 수정하세요.");
  const next = { ...order, registrationConfirmed: true, status: "READY" as const };
  const saved = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? next : o) });
  // 입금 전에 고친 아이디·배송 정보도 고객에 남긴다.
  return { ...saved, customers: updateCustomer(saved, order.instagramId, order.delivery!, broadcast.createdAt) };
}

/** 출력 대기 주문을 입금 전으로 되돌린다. 배송 정보는 그대로 두고, 입금 확인을 다시 받는다. */
export function revertToWaiting(state: DashboardState, broadcastId: string, orderId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "READY") throw new Error("출력 대기 주문이 아닙니다.");
  return replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? { ...o, status: "WAITING" as const, registrationConfirmed: false } : o) });
}

export function editOrder(state: DashboardState, broadcastId: string, orderId: string, delivery: Delivery, draftInstagramId = "", draftShippingMessage?: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order || order.status === "COMPLETED") throw new Error("완료 주문은 출력 대기로 되돌린 후 수정하세요.");
  const instagramId = canonicalInstagramId(draftInstagramId || order.instagramId);
  if (!instagramId) throw new Error("인스타그램 아이디를 입력하세요.");
  const normalized = normalizedDelivery(delivery);
  const customer = savedCustomerFor(state, instagramId);
  const idChanged = !sameId(order.instagramId, instagramId);
  const conflict = idChanged
    ? customer && !sameDelivery(customer.delivery, normalized) ? { previous: { ...customer.delivery }, incoming: normalized, customerId: customer.id } : null
    : order.conflict && !sameDelivery(order.conflict.previous, normalized) ? { ...order.conflict, incoming: normalized } : null;
  // 입금 확인만 남은 주문은 정보를 고쳐 저장해도 입금 전으로 남는다.
  const awaitingPayment = !order.registrationConfirmed && Boolean(order.delivery) && orderIssues(broadcast, order).length === 0;
  const edited = { ...order, instagramId, delivery: normalized, shippingMessage: normalizeText(draftShippingMessage ?? order.shippingMessage ?? ""), extractionWarnings: [], registrationConfirmed: !awaitingPayment, conflict };
  const refreshed = refreshStatus(broadcast, edited);
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? refreshed : o) });
  return refreshed.status === "READY" ? { ...next, customers: updateCustomer(next, instagramId, normalized, broadcast.createdAt) } : next;
}

export function resolveConflict(state: DashboardState, broadcastId: string, orderId: string, choice: "previous" | "incoming") {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  if (!order?.conflict || order.status === "COMPLETED") throw new Error("비교할 고객정보가 없습니다.");
  const delivery = normalizedDelivery(order.conflict[choice]);
  if (deliveryIssues(delivery).length) throw new Error("선택한 정보에 누락 또는 연락처 오류가 있습니다. 먼저 수정하세요.");
  const nextOrder = refreshStatus(broadcast, { ...order, delivery, conflict: null, registrationConfirmed: true });
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.map((o) => o.id === orderId ? nextOrder : o) });
  return { ...next, customers: updateCustomer(next, order.instagramId, delivery, broadcast.createdAt) };
}

export function matchOrder(state: DashboardState, broadcastId: string, orderId: string, settlementId: string) {
  const broadcast = getBroadcast(state, broadcastId);
  const order = broadcast.orders.find((o) => o.id === orderId);
  const settlement = broadcast.settlements.find((s) => s.id === settlementId);
  if (!order || !settlement || order.status === "COMPLETED") throw new Error("연결할 주문을 확인하세요.");
  const occupied = broadcast.orders.find((o) => o.settlementId === settlementId && o.id !== orderId);
  if (occupied && (occupied.registrationConfirmed || occupied.status !== "WAITING")) throw new Error("이미 주문서가 등록된 정산 주문입니다.");
  const customer = savedCustomerFor(state, settlement.instagramId);
  const matched = { ...order, instagramId: settlement.instagramId, settlementId,
    conflict: customer && order.delivery && !sameDelivery(customer.delivery, order.delivery) ? { previous: { ...customer.delivery }, incoming: { ...order.delivery }, customerId: customer.id } : null };
  const nextOrder = refreshStatus(broadcast, matched);
  const next = replaceBroadcast(state, { ...broadcast, orders: broadcast.orders.filter((o) => o.id !== occupied?.id).map((o) => o.id === orderId ? nextOrder : o) });
  return nextOrder.status === "READY" && nextOrder.delivery ? { ...next, customers: updateCustomer(next, nextOrder.instagramId, nextOrder.delivery, broadcast.createdAt) } : next;
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
    return [info.name, info.address, "", info.phone, info.phone, order.shippingMessage ?? "", order.instagramId];
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
  const blank = !normalized.name && !normalized.address && !normalized.phone;
  // 아이디만 있는 고객은 배송정보를 비워 둔 채 저장할 수 있다.
  if (!blank && deliveryIssues(normalized).length) throw new Error("성명, 주소와 010 형식의 연락처를 입력하세요.");
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) throw new Error("고객 정보를 찾을 수 없습니다.");
  const instagramId = canonicalInstagramId(draftInstagramId || customer.instagramId);
  if (!instagramId) throw new Error("인스타그램 아이디를 입력하세요.");
  if (state.customers.some((item) => item.id !== customerId && customerIds(item).includes(instagramId))) throw new Error("이미 저장된 인스타그램 아이디입니다.");
  const lastOrderedAt = customerLastOrderedAt(state, customer);
  return { ...state, customers: state.customers.map((item) => item.id === customerId ? { ...item, instagramId, delivery: normalized, updatedAt: now(), lastOrderedAt: lastOrderedAt ?? item.lastOrderedAt } : item) };
}

/** 주문서를 쓰지 않은 사람도 체크·차단을 이어가도록 아이디만으로 고객을 만든다. 이미 있으면 그 고객을 돌려준다. */
export function ensureCustomer(state: DashboardState, draftInstagramId: string): { state: DashboardState; customerId: string; created: boolean } {
  const instagramId = canonicalInstagramId(draftInstagramId);
  if (!instagramId) throw new Error("인스타그램 아이디를 입력하세요.");
  const existing = customerFor(state, instagramId);
  if (existing) return { state, customerId: existing.id, created: false };
  const customer: Customer = { id: id(), instagramId, delivery: emptyDelivery(), updatedAt: now(), blocked: false, legacyCheckCount: 0, checkHistory: [] };
  return { state: { ...state, customers: [customer, ...state.customers] }, customerId: customer.id, created: true };
}

export function deleteCustomer(state: DashboardState, customerId: string) {
  return { ...state, customers: state.customers.filter((c) => c.id !== customerId) };
}

export function customerCheckCount(customer: Customer) {
  return Math.max(0, customer.legacyCheckCount ?? 0) + (customer.checkHistory?.length ?? 0);
}

export function customerStatusLabel(customer: Customer) {
  if (customer.blocked) return "차단";
  const count = customerCheckCount(customer);
  return count ? `체크 ${count}회` : "활성";
}

export function customerLastOrderedAt(state: DashboardState, customer: Customer) {
  let latest: string | null = customer.lastOrderedAt ?? null;
  const ids = new Set(customerIds(customer));
  for (const broadcast of state.broadcasts) {
    if (broadcast.orders.some((order) => ids.has(canonicalInstagramId(order.instagramId))) && (!latest || broadcast.createdAt > latest)) latest = broadcast.createdAt;
  }
  return latest;
}

export function customerOrderHistory(state: DashboardState, customer: Customer) {
  const ids = new Set(customerIds(customer));
  return state.broadcasts.flatMap((broadcast) => broadcast.orders
    .filter((order) => ids.has(canonicalInstagramId(order.instagramId)))
    .map((order) => {
      const settlement = broadcast.settlements.find((item) => item.id === order.settlementId);
      return {
        id: `${broadcast.id}:${order.id}`,
        broadcastId: broadcast.id,
        broadcastTitle: broadcast.title,
        instagramId: order.instagramId,
        orderedAt: broadcast.createdAt,
        status: order.status,
        total: settlement?.total ?? null,
        quantity: settlement?.quantity ?? null,
        items: settlement?.items ?? [],
      };
    })).sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
}

function updateCustomerRecord(state: DashboardState, customerId: string, update: (customer: Customer) => Customer) {
  if (!state.customers.some((customer) => customer.id === customerId)) throw new Error("고객 정보를 찾을 수 없습니다.");
  return { ...state, customers: state.customers.map((customer) => customer.id === customerId ? update(customer) : customer) };
}

export function setCustomerBlocked(state: DashboardState, customerId: string, blocked: boolean) {
  return updateCustomerRecord(state, customerId, (customer) => ({ ...customer, blocked, updatedAt: now() }));
}

function validCheckDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function addCustomerCheck(state: DashboardState, customerId: string, date: string, note: string) {
  if (!validCheckDate(date)) throw new Error("체크 날짜를 확인하세요.");
  const check: CustomerCheck = { id: id(), date, note: note.trim() };
  return updateCustomerRecord(state, customerId, (customer) => ({ ...customer, checkHistory: [check, ...(customer.checkHistory ?? [])], updatedAt: now() }));
}

export function editCustomerCheck(state: DashboardState, customerId: string, checkId: string, date: string, note: string) {
  if (!validCheckDate(date)) throw new Error("체크 날짜를 확인하세요.");
  return updateCustomerRecord(state, customerId, (customer) => {
    if (!(customer.checkHistory ?? []).some((check) => check.id === checkId)) throw new Error("체크 이력을 찾을 수 없습니다.");
    return { ...customer, checkHistory: (customer.checkHistory ?? []).map((check) => check.id === checkId ? { ...check, date, note: note.trim() } : check), updatedAt: now() };
  });
}

export function deleteCustomerCheck(state: DashboardState, customerId: string, checkId: string) {
  return updateCustomerRecord(state, customerId, (customer) => {
    if (!(customer.checkHistory ?? []).some((check) => check.id === checkId)) throw new Error("체크 이력을 찾을 수 없습니다.");
    return { ...customer, checkHistory: (customer.checkHistory ?? []).filter((check) => check.id !== checkId), updatedAt: now() };
  });
}

export function summarizeCustomerImport(state: DashboardState, records: CustomerImportRecord[]): CustomerImportSummary {
  let created = 0; let updated = 0; let unchanged = 0;
  for (const record of records) {
    const customer = customerFor(state, record.instagramId);
    if (!customer) created += 1;
    else if (sameDelivery(customer.delivery, record.delivery)) unchanged += 1;
    else updated += 1;
  }
  return { created, updated, unchanged, total: records.length };
}

export function importCustomers(state: DashboardState, records: CustomerImportRecord[]) {
  const summary = summarizeCustomerImport(state, records);
  const importedAt = now();
  const incoming = new Map(records.map((record) => [canonicalInstagramId(record.instagramId), record]));
  const customers = state.customers.map((customer) => {
    const keys = customerIds(customer).filter((key) => incoming.has(key));
    if (!keys.length) return customer;
    const record = incoming.get(keys[0])!;
    for (const key of keys) incoming.delete(key);
    if (sameDelivery(customer.delivery, record.delivery)) return customer;
    // 합쳐진 아이디로 온 행은 대표 아이디를 바꾸지 않는다.
    return { ...customer, instagramId: sameId(customer.instagramId, record.instagramId) ? record.instagramId : customer.instagramId, delivery: normalizedDelivery(record.delivery), updatedAt: importedAt };
  });
  for (const record of incoming.values()) {
    customers.unshift({ id: id(), instagramId: record.instagramId, delivery: normalizedDelivery(record.delivery), updatedAt: importedAt, blocked: false, legacyCheckCount: 0, checkHistory: [] });
  }
  return { state: { ...state, customers }, summary };
}

// ── 중복 고객 ─────────────────────────────────────────────

export type DuplicateGroup = { customers: Customer[]; samePhone: boolean; sameName: boolean };

const deliveryPhoneKey = (delivery: Delivery) => { const digits = delivery.phone.replace(/\D/g, ""); return digits.length >= 10 ? digits : ""; };
const phoneKey = (customer: Customer) => deliveryPhoneKey(customer.delivery);
/** 비슷할 수 있는 아이디끼리 겹치는 열쇠. 점·밑줄을 뺀 모양과, 한 글자를 지운 모양(5자 이상). */
function idKeys(instagramId: string) {
  const key = canonicalInstagramId(instagramId);
  const shape = key.replace(/[._]/g, "");
  const keys = shape ? [`shape:${shape}`] : [];
  if (key.length < 5) return keys;
  keys.push(`near:${key}`);
  for (let at = 0; at < key.length; at += 1) keys.push(`near:${key.slice(0, at)}${key.slice(at + 1)}`);
  return keys;
}
/** 점·밑줄만 다르거나, 5자 이상에서 한 글자만 다른 아이디인지. */
function similarIds(a: string, b: string) {
  const left = canonicalInstagramId(a); const right = canonicalInstagramId(b);
  const shape = left.replace(/[._]/g, "");
  if (shape && shape === right.replace(/[._]/g, "")) return true;
  return Math.min(left.length, right.length) >= 5 && distance(left, right) <= 1;
}
const markedDistinct = (a: Customer, b: Customer) => Boolean(a.distinctFrom?.includes(b.id) || b.distinctFrom?.includes(a.id));

/** 연락처가 같거나, 아이디가 점·밑줄만 다르거나, 5자 이상에서 한 글자만 다른 고객 묶음. 합칠지는 사람이 확인한다. 최근 주문 순. */
export function customerDuplicateGroups(state: DashboardState): DuplicateGroup[] {
  const { customers } = state;
  // 전체 쌍을 비교하지 않도록 같은 사람일 수 있는 고객끼리만 모은다. 한 글자 차이는 한 글자를 지운 모양이 겹친다.
  const buckets = new Map<string, number[]>();
  const add = (key: string, index: number) => { const bucket = buckets.get(key); if (bucket) bucket.push(index); else buckets.set(key, [index]); };
  customers.forEach((customer, index) => {
    const phone = phoneKey(customer);
    if (phone) add(`phone:${phone}`, index);
    for (const key of idKeys(customer.instagramId)) add(key, index);
  });
  const parent = customers.map((_, index) => index);
  const root = (index: number): number => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
  for (const [key, members] of buckets) {
    for (let i = 0; i < members.length; i += 1) for (let j = i + 1; j < members.length; j += 1) {
      const a = customers[members[i]]; const b = customers[members[j]];
      if (markedDistinct(a, b)) continue;
      if (key.startsWith("near:") && !similarIds(a.instagramId, b.instagramId)) continue;
      parent[root(members[j])] = root(members[i]);
    }
  }
  const groups = new Map<number, Customer[]>();
  customers.forEach((customer, index) => { const key = root(index); groups.set(key, [...(groups.get(key) ?? []), customer]); });
  const found = [...groups.values()].filter((group) => group.length > 1);
  const latest = new Map(found.flat().map((customer) => [customer.id, customerLastOrderedAt(state, customer) ?? ""]));
  const byLatest = (a: Customer, b: Customer) => latest.get(b.id)!.localeCompare(latest.get(a.id)!);
  return found.map((group) => {
    const names = new Set(group.map((customer) => normalizeText(customer.delivery.name)).filter(Boolean));
    return { customers: [...group].sort(byLatest), samePhone: Boolean(phoneKey(group[0])) && group.every((customer) => phoneKey(customer) === phoneKey(group[0])), sameName: names.size <= 1 };
  }).sort((a, b) => byLatest(a.customers[0], b.customers[0]));
}

/**
 * 고객들을 대표 고객 하나로 합친다. 대표의 아이디·배송 정보가 남고(대표에 배송 정보가 없으면 채운다), 체크·차단은 모은다.
 * 방송 주문은 바꾸지 않으므로 splitCustomer로 되돌릴 수 있다.
 */
export function mergeCustomers(state: DashboardState, mainId: string, sourceIds: string[]) {
  const main = state.customers.find((customer) => customer.id === mainId);
  const sources = state.customers.filter((customer) => customer.id !== mainId && sourceIds.includes(customer.id));
  if (!main || !sources.length) throw new Error("합칠 고객을 찾을 수 없습니다.");
  const involved = new Set([main.id, ...sources.map((source) => source.id)]);
  const merged: Customer = {
    ...main,
    delivery: hasSavedDelivery(main) ? main.delivery : { ...(sources.find(hasSavedDelivery)?.delivery ?? main.delivery) },
    blocked: [main, ...sources].some((customer) => customer.blocked),
    legacyCheckCount: [main, ...sources].reduce((sum, customer) => sum + Math.max(0, customer.legacyCheckCount ?? 0), 0),
    checkHistory: [main, ...sources].flatMap((customer) => customer.checkHistory ?? []),
    lastOrderedAt: [main, ...sources].map((customer) => customer.lastOrderedAt).filter((value): value is string => Boolean(value)).sort().at(-1),
    mergedCustomers: [...(main.mergedCustomers ?? []), ...sources.flatMap(({ mergedCustomers = [], ...source }) => [source, ...mergedCustomers])],
    distinctFrom: [...new Set([main, ...sources].flatMap((customer) => customer.distinctFrom ?? []))].filter((id) => !involved.has(id)),
    updatedAt: now(),
  };
  return { ...state, customers: state.customers.filter((customer) => !sources.includes(customer)).map((customer) => customer.id === main.id ? merged : customer) };
}

/** 합쳐진 아이디를 다시 별도 고객으로 되돌린다. 합친 뒤에 추가한 체크는 대표에 남는다. */
export function splitCustomer(state: DashboardState, customerId: string, mergedId: string) {
  const main = state.customers.find((customer) => customer.id === customerId);
  const snapshot = main?.mergedCustomers?.find((customer) => customer.id === mergedId);
  if (!main || !snapshot) throw new Error("되돌릴 고객을 찾을 수 없습니다.");
  const movedChecks = new Set((snapshot.checkHistory ?? []).map((check) => check.id));
  const restored: Customer = { ...snapshot, distinctFrom: [...(snapshot.distinctFrom ?? []), main.id], updatedAt: now() };
  const remaining: Customer = {
    ...main,
    mergedCustomers: main.mergedCustomers!.filter((customer) => customer.id !== mergedId),
    legacyCheckCount: Math.max(0, (main.legacyCheckCount ?? 0) - (snapshot.legacyCheckCount ?? 0)),
    checkHistory: (main.checkHistory ?? []).filter((check) => !movedChecks.has(check.id)),
    // 최근 주문이 되돌린 고객 것이었으면 비워서 남은 주문으로 다시 계산되게 한다.
    lastOrderedAt: main.lastOrderedAt === snapshot.lastOrderedAt ? undefined : main.lastOrderedAt,
    distinctFrom: [...(main.distinctFrom ?? []), snapshot.id],
    updatedAt: now(),
  };
  return { ...state, customers: [restored, ...state.customers.map((customer) => customer.id === main.id ? remaining : customer)] };
}

/** "다른 사람"으로 표시해 이 고객을 묶음의 나머지 고객들과 함께 추천하지 않는다. */
export function markCustomerDistinct(state: DashboardState, customerId: string, otherIds: string[]) {
  return updateCustomerRecord(state, customerId, (customer) => ({ ...customer, distinctFrom: [...new Set([...(customer.distinctFrom ?? []), ...otherIds])], updatedAt: now() }));
}

export type CustomerSuggestion = { reason: "id" | "phone"; customers: Customer[] };

/**
 * 진행 중인 주문마다 같은 사람일 수 있는 기존 고객을 찾는다.
 * 연락처가 있으면(주문서 등록 뒤) 같은 연락처로, 없으면(정산 직후) 비슷한 아이디로 찾는다. 합칠지는 사람이 정한다.
 */
export function orderCustomerSuggestions(state: DashboardState, broadcast: Broadcast) {
  const byId = new Map<string, Customer>();
  const byPhone = new Map<string, Customer[]>();
  const byKey = new Map<string, Customer[]>();
  const push = (map: Map<string, Customer[]>, key: string, customer: Customer) => { const list = map.get(key); if (!list) map.set(key, [customer]); else if (!list.includes(customer)) list.push(customer); };
  for (const customer of state.customers) {
    const phone = phoneKey(customer);
    if (phone) push(byPhone, phone, customer);
    for (const instagramId of customerIds(customer)) {
      byId.set(instagramId, customer);
      for (const key of idKeys(instagramId)) push(byKey, key, customer);
    }
  }
  const suggestions = new Map<string, CustomerSuggestion>();
  for (const order of broadcast.orders) {
    const instagramId = canonicalInstagramId(order.instagramId);
    if (!instagramId || order.status === "COMPLETED") continue;
    const own = byId.get(instagramId);
    const notOwn = (customer: Customer) => customer !== own && !(own && markedDistinct(own, customer));
    const phone = order.delivery ? deliveryPhoneKey(order.delivery) : "";
    if (phone) {
      const customers = (byPhone.get(phone) ?? []).filter(notOwn);
      if (customers.length) suggestions.set(order.id, { reason: "phone", customers });
    } else if (!own || !hasSavedDelivery(own)) {
      const found = new Set(idKeys(instagramId).flatMap((key) => byKey.get(key) ?? []));
      const customers = [...found].filter((customer) => notOwn(customer) && customerIds(customer).some((other) => similarIds(instagramId, other)));
      if (customers.length) suggestions.set(order.id, { reason: "id", customers });
    }
  }
  return suggestions;
}

/** 주문의 아이디를 기존 고객에 합친다. 주문서가 없으면 저장된 배송 정보를 채우고, 주문서가 다르면 어느 쪽을 쓸지 묻는다. */
export function linkOrderToCustomer(state: DashboardState, broadcastId: string, orderId: string, customerId: string) {
  const order = getBroadcast(state, broadcastId).orders.find((item) => item.id === orderId);
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  const ensured = ensureCustomer(state, order.instagramId);
  if (ensured.customerId === customerId) throw new Error("이미 같은 고객이에요.");
  const merged = mergeCustomers(ensured.state, customerId, [ensured.customerId]);
  const customer = merged.customers.find((item) => item.id === customerId)!;
  if (!hasSavedDelivery(customer) || order.status === "COMPLETED") return merged;
  let next = order;
  if (!order.delivery && !order.sourceText) next = { ...order, delivery: { ...customer.delivery }, registrationConfirmed: false };
  else if (order.delivery && !sameDelivery(customer.delivery, order.delivery)) next = { ...order, conflict: { previous: { ...customer.delivery }, incoming: { ...order.delivery }, customerId } };
  if (next === order) return merged;
  return { ...merged, broadcasts: merged.broadcasts.map((broadcast) => broadcast.id === broadcastId ? { ...broadcast, orders: broadcast.orders.map((item) => item.id === orderId ? refreshStatus(broadcast, next) : item) } : broadcast) };
}

/** 제안받은 고객들과 다른 사람이라고 기록한다. 아직 고객이 아니면 아이디만으로 만들어 둔다. */
export function dismissOrderSuggestion(state: DashboardState, instagramId: string, customerIds: string[]) {
  const ensured = ensureCustomer(state, instagramId);
  return markCustomerDistinct(ensured.state, ensured.customerId, customerIds);
}

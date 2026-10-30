import { pantsGroupBuy } from "../mock";
import { GroupBuyError, lookupOrders, normalizePhone, submitOrder, validPhone, type SubmitRequest, type SubmitResult } from "../model";
import { diffState, emptyChanges, orderPut, publicOrder, publicState, stockLogPut, storedGroupBuy, withOrderedQty, type Changes, type Versions } from "../sync";
import type { GbOrder, GbStockLog, GroupBuyState } from "../types";
import { backend } from "./backend";

// 공구 서버 기능. 화면과 같은 model 함수를 서버에서 실행해, 금액·주문번호·재고 기록을 브라우저가 조작할 수 없게 한다.

export const EXAMPLE_GROUP_BUY_ID = "gb-magic-pants";

const INPUT_KEYS = ["customerName", "phone", "recipientName", "recipientPhone", "postcode", "address", "addressDetail", "shippingMessage", "depositorName", "pin"] as const;

/** 브라우저가 보낸 주문 요청을 믿지 않고 모양을 맞춘다(빠진 칸은 빈 값 → model 검사에서 걸림). */
function cleanRequest(raw: unknown): SubmitRequest {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return {
    groupBuyId: String(body.groupBuyId ?? ""),
    lines: lines.slice(0, 100).map((line) => ({ optionId: String((line as { optionId?: unknown })?.optionId ?? ""), quantity: Math.max(0, Math.min(999, Math.floor(Number((line as { quantity?: unknown })?.quantity) || 0))) })),
    input: Object.fromEntries(INPUT_KEYS.map((key) => [key, String(input[key] ?? "").slice(0, 300)])) as SubmitRequest["input"],
    expectedTotal: typeof body.expectedTotal === "number" ? body.expectedTotal : null,
    source: body.source === "manual" ? "manual" : "form",
    allowOverStock: body.allowOverStock === true,
  };
}

const stateOf = (partial: Partial<GroupBuyState>): GroupBuyState => ({ version: 1, groupBuys: [], orders: [], stockLogs: [], orderSeq: 0, lookupLocks: {}, ...partial });

// ── 관리자 ───────────────────────────────────────────────

export async function adminSnapshot() {
  const { state, versions } = await backend().snapshot();
  return { state: withOrderedQty(state), versions, storage: backend().kind };
}

export async function adminCommit(changes: Changes) {
  return backend().commit({ ...emptyChanges(), ...changes });
}

export type ServerSubmitResult =
  | { ok: true; order: GbOrder; stockLogs: GbStockLog[]; versions: Versions }
  | Exclude<SubmitResult, { ok: true }>;

/**
 * 주문 접수. 1) 순번 없이 검사 → 2) 통과하면 순번을 받아 주문번호를 붙여 다시 만들고 → 3) 주문·재고 기록을 한 번에 저장.
 * 검사에서 떨어진 주문은 순번을 쓰지 않는다.
 */
async function submit(raw: SubmitRequest): Promise<ServerSubmitResult> {
  const request = cleanRequest(raw);
  const store = backend();
  const groupBuy = await store.groupBuyById(request.groupBuyId);
  if (!groupBuy) return { ok: false, code: "CLOSED", message: "공구를 찾을 수 없습니다." };
  const dry = submitOrder(stateOf({ groupBuys: [groupBuy] }), request);
  if (!dry.ok) return dry;
  const seq = await store.nextOrderSeq();
  const base = stateOf({ groupBuys: [groupBuy], orderSeq: seq - 1 });
  const result = submitOrder(base, request);
  if (!result.ok) return result;
  const stockLogs = result.state.stockLogs;
  const versions = await store.commit({ ...emptyChanges(), orders: [orderPut(result.order, null)], stockLogs: stockLogs.map((log) => stockLogPut(log, groupBuy.id)) });
  return { ok: true, order: result.order, stockLogs, versions };
}

/** 관리자 수기 주문: 품절 확정 옵션도 넣을 수 있다. */
export function adminSubmitOrder(request: SubmitRequest) {
  return submit({ ...request, source: "manual" });
}

/** 예시 공구(마약 팬츠)를 넣는다. 주문자 데모 데이터 없이 상품·옵션·설정만. 이미 있으면 그대로 둔다. */
export async function insertExample() {
  const store = backend();
  if (await store.groupBuyById(EXAMPLE_GROUP_BUY_ID)) throw new GroupBuyError("STATE", "마약 팬츠 예시가 이미 있어요.");
  const groupBuy = storedGroupBuy(pantsGroupBuy());
  await store.commit({ ...emptyChanges(), groupBuys: [{ op: "put", id: groupBuy.id, slug: groupBuy.slug, data: groupBuy, version: null }] });
}

export async function uploadImage(bytes: Uint8Array, contentType: string) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) throw new GroupBuyError("INVALID", "jpg·png·webp 이미지만 올릴 수 있어요.");
  if (bytes.length > 4 * 1024 * 1024) throw new GroupBuyError("INVALID", "이미지가 너무 커요(4MB 이하).");
  return backend().uploadImage(bytes, contentType);
}

// ── 고객 ─────────────────────────────────────────────────

export async function publicGroupBuyState(slug: string) {
  const groupBuy = await backend().groupBuyBySlug(slug);
  return publicState(groupBuy ? [groupBuy] : []);
}

/** 고객 주문서 제출. 고객 화면에서는 항상 주문서(form) 경로로만 받는다. */
export async function customerSubmitOrder(request: SubmitRequest) {
  const result = await submit({ ...request, source: "form", allowOverStock: false });
  if (!result.ok) return result;
  return { ok: true as const, order: publicOrder(result.order) };
}

export async function orderByTokenState(token: string) {
  const store = backend();
  const order = /^[a-f0-9]{32}$/.test(token) ? await store.orderByToken(token) : null;
  if (!order) return publicState([]);
  const groupBuy = await store.groupBuyById(order.groupBuyId);
  return publicState(groupBuy ? [groupBuy] : [], [order]);
}

/** 휴대폰 번호 + 비밀번호 조회. 틀린 횟수와 잠금은 서버에 남는다. */
export async function lookup(phoneInput: string, pin: string) {
  const store = backend();
  const phone = normalizePhone(phoneInput);
  // 형식이 틀린 입력은 조회·잠금 기록 없이 돌려보낸다.
  if (!validPhone(phone) || !/^\d{4}$/.test(pin)) return { ok: false as const, message: "휴대폰 번호와 비밀번호 4자리를 확인해 주세요.", lockedUntil: null };
  const [orders, lock] = await Promise.all([store.ordersByPhone(phone), store.lookupLock(phone)]);
  const base = stateOf({ orders, lookupLocks: lock ? { [phone]: lock } : {} });
  const { state, result } = lookupOrders(base, phone, pin);
  const changes = diffState(base, state, { groupBuys: {}, orders: {} });
  if (changes.lookupLocks.length) await store.commit({ ...emptyChanges(), lookupLocks: changes.lookupLocks });
  if (!result.ok) return { ok: false as const, message: result.message, lockedUntil: result.lockedUntil };
  const groupBuys = await store.groupBuysByIds([...new Set(result.orders.map((order) => order.groupBuyId))]);
  return { ok: true as const, state: publicState(groupBuys, result.orders) };
}

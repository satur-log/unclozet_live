import type { GbOption, GbOrder, GbStockLog, GroupBuy, GroupBuyState, LookupLock } from "./types";

// 공구 데이터를 Supabase 행 단위로 주고받기 위한 순수 함수들(브라우저·서버 공용).
// 화면은 지금처럼 GroupBuyState 전체에 model 함수를 적용하고, 저장할 때만 바뀐 행을 골라 보낸다.

/** 행 버전. 다른 곳에서 먼저 고친 행을 덮어쓰지 않도록 저장할 때 함께 보낸다. */
export type Versions = { groupBuys: Record<string, number>; orders: Record<string, number> };

export type GroupBuyPut = { op: "put"; id: string; slug: string; data: GroupBuy; version: number | null };
export type OrderPut = { op: "put"; id: string; groupBuyId: string; orderNo: string; phone: string; lookupToken: string; createdAt: string; data: GbOrder; version: number | null };
export type StockLogPut = { op: "put"; id: string; groupBuyId: string; createdAt: string; data: GbStockLog };
export type LockPut = { op: "put"; phone: string; data: LookupLock };
export type Changes = {
  groupBuys: (GroupBuyPut | { op: "delete"; id: string })[];
  orders: (OrderPut | { op: "delete"; id: string })[];
  stockLogs: (StockLogPut | { op: "delete"; id: string })[];
  lookupLocks: (LockPut | { op: "delete"; phone: string })[];
};

export const emptyChanges = (): Changes => ({ groupBuys: [], orders: [], stockLogs: [], lookupLocks: [] });
export const hasChanges = (changes: Changes) => Object.values(changes).some((list) => list.length > 0);

/** 저장 전용 형태: 주문 수량(orderedQty)은 주문에서 다시 계산하므로 저장하지 않는다. */
export function storedGroupBuy(groupBuy: GroupBuy): GroupBuy {
  return { ...groupBuy, products: groupBuy.products.map((product) => ({ ...product, options: product.options.map((option) => ({ ...option, orderedQty: 0 })) })) };
}

/**
 * 옵션별 주문 수량 = 취소되지 않은 주문의 수량 합. 저장하지 않고 매번 계산해서,
 * 고객 주문이 동시에 들어와도 공구 행을 고칠 일이 없게 한다.
 */
export function withOrderedQty(state: GroupBuyState): GroupBuyState {
  const ordered = new Map<string, number>();
  for (const order of state.orders) {
    if (order.cancelledAt) continue;
    for (const item of order.items) ordered.set(item.optionId, (ordered.get(item.optionId) ?? 0) + item.quantity);
  }
  return {
    ...state,
    groupBuys: state.groupBuys.map((groupBuy) => ({ ...groupBuy, products: groupBuy.products.map((product) => ({ ...product, options: product.options.map((option) => ({ ...option, orderedQty: ordered.get(option.id) ?? 0 })) })) })),
  };
}

// 키 순서와 상관없이 비교한다(Postgres jsonb는 키 순서를 바꿔 저장한다).
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const same = (a: unknown, b: unknown) => a === b || stable(a) === stable(b);

function optionOwners(...states: GroupBuyState[]) {
  const owner = new Map<string, string>();
  for (const state of states) for (const groupBuy of state.groupBuys) for (const product of groupBuy.products) for (const option of product.options) owner.set(option.id, groupBuy.id);
  return owner;
}

export const orderPut = (order: GbOrder, version: number | null): OrderPut => ({ op: "put", id: order.id, groupBuyId: order.groupBuyId, orderNo: order.orderNo, phone: order.phone, lookupToken: order.lookupToken, createdAt: order.createdAt, data: order, version });
export const stockLogPut = (log: GbStockLog, groupBuyId: string): StockLogPut => ({ op: "put", id: log.id, groupBuyId, createdAt: log.createdAt, data: log });

/** base → next 사이에 바뀐 행만 고른다. version은 보낼 때(versionsOf) 붙인다. */
export function diffState(base: GroupBuyState, next: GroupBuyState, versions: Versions): Changes {
  const changes = emptyChanges();
  const baseGroupBuys = new Map(base.groupBuys.map((item) => [item.id, item]));
  for (const groupBuy of next.groupBuys) {
    const before = baseGroupBuys.get(groupBuy.id);
    if (before && (before === groupBuy || same(storedGroupBuy(before), storedGroupBuy(groupBuy)))) continue;
    changes.groupBuys.push({ op: "put", id: groupBuy.id, slug: groupBuy.slug, data: storedGroupBuy(groupBuy), version: before ? versions.groupBuys[groupBuy.id] ?? null : null });
  }
  const nextGroupBuyIds = new Set(next.groupBuys.map((item) => item.id));
  for (const groupBuy of base.groupBuys) if (!nextGroupBuyIds.has(groupBuy.id)) changes.groupBuys.push({ op: "delete", id: groupBuy.id });

  const baseOrders = new Map(base.orders.map((item) => [item.id, item]));
  for (const order of next.orders) {
    const before = baseOrders.get(order.id);
    if (before && (before === order || same(before, order))) continue;
    changes.orders.push(orderPut(order, before ? versions.orders[order.id] ?? null : null));
  }
  const nextOrderIds = new Set(next.orders.map((item) => item.id));
  for (const order of base.orders) if (!nextOrderIds.has(order.id)) changes.orders.push({ op: "delete", id: order.id });

  // 재고 기록은 고치지 않고 쌓기만 한다(공구 삭제 때만 지움).
  const owner = optionOwners(next, base);
  const baseLogs = new Set(base.stockLogs.map((log) => log.id));
  for (const log of next.stockLogs) if (!baseLogs.has(log.id)) changes.stockLogs.push(stockLogPut(log, owner.get(log.optionId) ?? ""));
  const nextLogs = new Set(next.stockLogs.map((log) => log.id));
  for (const log of base.stockLogs) if (!nextLogs.has(log.id)) changes.stockLogs.push({ op: "delete", id: log.id });

  for (const [phone, lock] of Object.entries(next.lookupLocks)) if (!same(base.lookupLocks[phone], lock)) changes.lookupLocks.push({ op: "put", phone, data: lock });
  for (const phone of Object.keys(base.lookupLocks)) if (!(phone in next.lookupLocks)) changes.lookupLocks.push({ op: "delete", phone });
  return changes;
}

/** 보내기 직전에 최신 버전을 붙인다(앞서 보낸 저장이 버전을 올렸을 수 있다). */
export function withVersions(changes: Changes, versions: Versions): Changes {
  return {
    ...changes,
    groupBuys: changes.groupBuys.map((item) => item.op === "put" && item.version != null ? { ...item, version: versions.groupBuys[item.id] ?? item.version } : item),
    orders: changes.orders.map((item) => item.op === "put" && item.version != null ? { ...item, version: versions.orders[item.id] ?? item.version } : item),
  };
}

/** 서버가 돌려준 새 버전을 반영한다. 지운 행의 버전은 버린다. */
export function applyVersions(versions: Versions, changes: Changes, updated: Versions): Versions {
  const groupBuys = { ...versions.groupBuys, ...updated.groupBuys };
  const orders = { ...versions.orders, ...updated.orders };
  for (const item of changes.groupBuys) if (item.op === "delete") delete groupBuys[item.id];
  for (const item of changes.orders) if (item.op === "delete") delete orders[item.id];
  return { groupBuys, orders };
}

// ── 고객에게 보내는 형태 ─────────────────────────────────

/** 고객 화면용 공구: 재고 수량은 감추고 품절 여부만 남긴다. */
export function publicGroupBuy(groupBuy: GroupBuy): GroupBuy {
  const hide = (option: GbOption): GbOption => ({ ...option, stockQty: null, orderedQty: 0, lowStockAlert: 0 });
  return { ...groupBuy, products: groupBuy.products.map((product) => ({ ...product, options: product.options.map(hide) })) };
}

/** 고객 화면용 주문: 조회 비밀번호 해시와 판매자 내부 기록은 빼고 보낸다. */
export function publicOrder(order: GbOrder): GbOrder {
  return { ...order, lookupPinHash: "", events: [] };
}

/** 고객 화면은 model 함수가 기대하는 GroupBuyState 모양으로 받는다(필요한 공구·주문만 담김). */
export function publicState(groupBuys: GroupBuy[], orders: GbOrder[] = []): GroupBuyState {
  return { version: 1, groupBuys: groupBuys.map(publicGroupBuy), orders: orders.map(publicOrder), stockLogs: [], orderSeq: 0, lookupLocks: {} };
}

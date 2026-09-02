import { analyzeSettlement, itemLabel } from "./settlement";
import { canonicalInstagramId, normalizePhoneNumber } from "./shipping-parser";
import type { Broadcast, Customer, DashboardState, Delivery, Order, OrderStatus, Settlement } from "./types";

export const LEGACY_IMPORT_KEY = "unclozet-dashboard-v2-legacy-import-v1";

export type LegacyMemo = {
  id: string;
  title: string;
  memo: string;
  paidNicknames: string[];
  createdAt: string;
  updatedAt: string;
};

export type LegacyShippingInfo = {
  name: string;
  address: string;
  zipCode: string;
  phone1: string;
  phone2: string;
  memo: string;
  items: string;
};

export type LegacyParticipant = {
  instagramId: string;
  status: OrderStatus;
  shippingInfo: LegacyShippingInfo | null;
};

export type LegacyShippingRound = {
  id: string;
  participants: LegacyParticipant[];
  createdAt: string;
  updatedAt: string;
};

type ImportStorage = Pick<Storage, "getItem" | "setItem">;

const legacyBroadcastId = (id: string) => `legacy-broadcast-${id}`;
const legacySettlementId = (memoId: string, instagramId: string) => `legacy-settlement-${memoId}-${canonicalInstagramId(instagramId)}`;
const legacyOrderId = (memoId: string, instagramId: string) => `legacy-order-${memoId}-${canonicalInstagramId(instagramId)}`;
const legacyCustomerId = (instagramId: string) => `legacy-customer-${canonicalInstagramId(instagramId)}`;

function deliveryFromLegacy(info: LegacyShippingInfo | null): Delivery | null {
  if (!info) return null;
  return {
    name: info.name.trim(),
    address: info.address.trim(),
    phone: normalizePhoneNumber(info.phone1 || info.phone2),
  };
}

function hasCompleteDelivery(delivery: Delivery | null) {
  return Boolean(delivery?.name && delivery.address && /^010-\d{4}-\d{4}$/.test(delivery.phone));
}

function safeStatus(status: OrderStatus, delivery: Delivery | null): OrderStatus {
  if (status === "COMPLETED") return "COMPLETED";
  return status === "READY" && hasCompleteDelivery(delivery) ? "READY" : "WAITING";
}

function importedBroadcast(memo: LegacyMemo, round: LegacyShippingRound | undefined): Broadcast {
  const analysis = analyzeSettlement(memo.memo);
  const settlements: Settlement[] = analysis.buyers.map((buyer) => ({
    id: legacySettlementId(memo.id, buyer.nickname),
    instagramId: buyer.nickname.replace(/^@/, ""),
    quantity: buyer.quantity,
    total: buyer.total,
    items: buyer.items.map(itemLabel),
  }));
  const settlementsById = new Map(settlements.map((settlement) => [canonicalInstagramId(settlement.instagramId), settlement]));
  const participantsById = new Map<string, LegacyParticipant>();
  for (const participant of round?.participants ?? []) {
    const key = canonicalInstagramId(participant.instagramId);
    if (key && !participantsById.has(key)) participantsById.set(key, participant);
  }

  const orderIds = new Set([...settlementsById.keys(), ...participantsById.keys()]);
  const orders: Order[] = [...orderIds].map((key) => {
    const participant = participantsById.get(key);
    const settlement = settlementsById.get(key);
    const delivery = deliveryFromLegacy(participant?.shippingInfo ?? null);
    const status = safeStatus(participant?.status ?? "WAITING", delivery);
    return {
      id: legacyOrderId(memo.id, participant?.instagramId ?? settlement?.instagramId ?? key),
      instagramId: (participant?.instagramId ?? settlement?.instagramId ?? key).replace(/^@/, ""),
      settlementId: settlement?.id ?? null,
      delivery,
      status,
      registrationConfirmed: status !== "WAITING",
      sourceText: "",
      extractionWarnings: [],
      conflict: null,
    };
  });

  return {
    id: legacyBroadcastId(memo.id),
    title: memo.title,
    memo: memo.memo,
    memoDraft: memo.memo,
    orderDraft: "",
    settlements,
    settlementErrors: analysis.errors,
    orders,
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
  };
}

function importedCustomers(broadcasts: Broadcast[]) {
  const byId = new Map<string, Customer>();
  for (const broadcast of [...broadcasts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    for (const order of broadcast.orders) {
      if (!hasCompleteDelivery(order.delivery)) continue;
      const key = canonicalInstagramId(order.instagramId);
      const previous = byId.get(key);
      byId.set(key, {
        id: previous?.id ?? legacyCustomerId(order.instagramId),
        instagramId: order.instagramId,
        delivery: { ...order.delivery! },
        updatedAt: broadcast.updatedAt,
        lastOrderedAt: broadcast.createdAt,
        blocked: previous?.blocked ?? false,
        legacyCheckCount: previous?.legacyCheckCount ?? 0,
        checkHistory: previous?.checkHistory ?? [],
      });
    }
  }
  return [...byId.values()];
}

export function mergeLegacyData(state: DashboardState, memos: LegacyMemo[], rounds: LegacyShippingRound[]) {
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const imported = memos.map((memo) => importedBroadcast(memo, roundById.get(`memo-${memo.id}`)));
  const existingBroadcastIds = new Set(state.broadcasts.map((broadcast) => broadcast.id));
  const newBroadcasts = imported.filter((broadcast) => !existingBroadcastIds.has(broadcast.id));
  const customers = state.customers.map((customer) => ({ ...customer }));
  for (const incoming of importedCustomers(imported)) {
    const existing = customers.find((customer) => canonicalInstagramId(customer.instagramId) === canonicalInstagramId(incoming.instagramId));
    if (!existing) customers.push(incoming);
    else if (!existing.lastOrderedAt || incoming.lastOrderedAt! > existing.lastOrderedAt) existing.lastOrderedAt = incoming.lastOrderedAt;
  }
  return {
    state: { ...state, broadcasts: [...newBroadcasts, ...state.broadcasts], customers },
    importedBroadcasts: newBroadcasts.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseMemos(value: unknown): LegacyMemo[] {
  if (!Array.isArray(value)) throw new Error("기존 방송 데이터 형식이 올바르지 않습니다.");
  return value.map((row) => {
    if (!isRecord(row)) throw new Error("기존 방송 데이터 형식이 올바르지 않습니다.");
    return {
      id: String(row.id),
      title: String(row.title ?? "이전 방송"),
      memo: String(row.memo ?? ""),
      paidNicknames: Array.isArray(row.paid_nicknames) ? row.paid_nicknames.filter((item): item is string => typeof item === "string") : [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
}

function parseRounds(value: unknown): LegacyShippingRound[] {
  if (!Array.isArray(value)) throw new Error("기존 배송 데이터 형식이 올바르지 않습니다.");
  return value.flatMap((row) => {
    if (!isRecord(row) || !Array.isArray(row.participants)) return [];
    const participants = row.participants.flatMap((participant): LegacyParticipant[] => {
      if (!isRecord(participant) || typeof participant.instagramId !== "string" || !["WAITING", "READY", "COMPLETED"].includes(String(participant.status))) return [];
      const rawInfo = participant.shippingInfo;
      const shippingInfo = isRecord(rawInfo) ? {
        name: String(rawInfo.name ?? ""), address: String(rawInfo.address ?? ""), zipCode: String(rawInfo.zipCode ?? ""),
        phone1: String(rawInfo.phone1 ?? ""), phone2: String(rawInfo.phone2 ?? ""), memo: String(rawInfo.memo ?? ""), items: String(rawInfo.items ?? ""),
      } : null;
      return [{ instagramId: participant.instagramId, status: participant.status as OrderStatus, shippingInfo }];
    });
    return [{ id: String(row.id), participants, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }];
  });
}

export async function fetchLegacyData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("기존 데이터 연결 정보가 없습니다.");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const [memosResponse, roundsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/live_memos?select=id,title,memo,paid_nicknames,created_at,updated_at&order=created_at.asc`, { headers }),
    fetch(`${url}/rest/v1/shipping_rounds?select=id,participants,created_at,updated_at&order=created_at.asc`, { headers }),
  ]);
  if (!memosResponse.ok || !roundsResponse.ok) throw new Error("기존 방송 데이터를 불러오지 못했습니다.");
  return { memos: parseMemos(await memosResponse.json()), rounds: parseRounds(await roundsResponse.json()) };
}

export function legacyImportCompleted(storage: ImportStorage) {
  return storage.getItem(LEGACY_IMPORT_KEY) === "completed";
}

export function markLegacyImportCompleted(storage: ImportStorage) {
  storage.setItem(LEGACY_IMPORT_KEY, "completed");
}

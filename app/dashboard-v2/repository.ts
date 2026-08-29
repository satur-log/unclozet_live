import type { DashboardState, Delivery } from "./types";
import { createMockState } from "./mock-data";

export const STORAGE_KEY = "unclozet-dashboard-v2-mock-v2";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const strings = (v: unknown, keys: string[]) => record(v) && keys.every((k) => typeof v[k] === "string");
const delivery = (v: unknown): v is Delivery => strings(v, ["name", "address", "phone"]);

export function isDashboardState(value: unknown): value is DashboardState {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.broadcasts) || !Array.isArray(value.customers)) return false;
  return value.customers.every((c) => strings(c, ["id", "instagramId", "updatedAt"]) && delivery(c.delivery)) && value.broadcasts.every((b) => {
    if (!strings(b, ["id", "title", "memo", "memoDraft", "orderDraft", "createdAt", "updatedAt"]) || !Array.isArray(b.settlements) || !Array.isArray(b.orders) || !Array.isArray(b.settlementErrors)) return false;
    return b.settlements.every((s: unknown) => record(s) && strings(s, ["id", "instagramId"]) && typeof s.total === "number" && Number.isFinite(s.total) && typeof s.quantity === "number" && Array.isArray(s.items) && s.items.every((i: unknown) => typeof i === "string"))
      && b.settlementErrors.every((e: unknown) => record(e) && strings(e, ["text", "message"]) && typeof e.line === "number")
      && b.orders.every((o: unknown) => record(o) && strings(o, ["id", "instagramId", "sourceText"]) && ["WAITING", "READY", "COMPLETED"].includes(String(o.status)) && typeof o.registrationConfirmed === "boolean" && (o.settlementId === null || typeof o.settlementId === "string") && (o.delivery === null || delivery(o.delivery)) && Array.isArray(o.extractionWarnings) && o.extractionWarnings.every((w: unknown) => typeof w === "string") && (o.conflict === null || (record(o.conflict) && typeof o.conflict.customerId === "string" && delivery(o.conflict.previous) && delivery(o.conflict.incoming))));
  });
}

export function loadMockState(storage: StoragePort): DashboardState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createMockState();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("V2 저장 데이터가 손상되었습니다. 데모 초기화로 복구할 수 있습니다."); }
  if (!isDashboardState(value)) throw new Error("V2 저장 데이터 형식이 다릅니다. 데모 초기화로 복구할 수 있습니다.");
  return value;
}

export function saveMockState(storage: StoragePort, state: DashboardState) {
  if (!isDashboardState(state)) throw new Error("저장 데이터 검증에 실패했습니다.");
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

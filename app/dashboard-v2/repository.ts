import type { DashboardState, Delivery } from "./types";
import { createMockState } from "./mock-data";

export const STORAGE_KEY = "unclozet-dashboard-v2-mock-v2";
export const LOCAL_TEST_STORAGE_KEY = "unclozet-dashboard-v2-local-test-v1";
type StoragePort = Pick<Storage, "getItem" | "setItem">;

export type DashboardStorageFailureKind = "quota" | "unavailable";
export class DashboardStorageError extends Error {
  constructor(
    public kind: DashboardStorageFailureKind,
    public operation: "read" | "write",
    public key: string,
    public payloadBytes?: number,
    cause?: unknown,
  ) {
    super(kind === "quota" ? "브라우저 저장 공간 한도를 넘었습니다." : "브라우저 저장 공간에 접근할 수 없습니다.");
    this.name = "DashboardStorageError";
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause });
  }
}

export function isDashboardStorageError(error: unknown): error is DashboardStorageError {
  return error instanceof DashboardStorageError;
}

function isQuotaExceeded(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; message?: unknown; code?: unknown };
  return value.name === "QuotaExceededError"
    || value.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || value.code === 22
    || value.code === 1014
    || (typeof value.message === "string" && /quota.{0,20}(exceed|full)|exceed.{0,20}quota/i.test(value.message));
}

export function dashboardStorageFailure(error: unknown, operation: "read" | "write", key: string, payloadBytes?: number) {
  return new DashboardStorageError(isQuotaExceeded(error) ? "quota" : "unavailable", operation, key, payloadBytes, error);
}
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const strings = (v: unknown, keys: string[]) => record(v) && keys.every((k) => typeof v[k] === "string");
const delivery = (v: unknown): v is Delivery => strings(v, ["name", "address", "phone"]);
const customerState = (v: unknown): boolean => record(v)
  && (v.mergedCustomers === undefined || (Array.isArray(v.mergedCustomers) && v.mergedCustomers.every((c: unknown) => strings(c, ["id", "instagramId", "updatedAt"]) && delivery((c as Record<string, unknown>).delivery) && customerState(c))))
  && (v.distinctFrom === undefined || (Array.isArray(v.distinctFrom) && v.distinctFrom.every((item: unknown) => typeof item === "string")))
  && (v.lastOrderedAt === undefined || typeof v.lastOrderedAt === "string")
  && (v.blocked === undefined || typeof v.blocked === "boolean")
  && (v.legacyCheckCount === undefined || (typeof v.legacyCheckCount === "number" && Number.isInteger(v.legacyCheckCount) && v.legacyCheckCount >= 0))
  && (v.checkHistory === undefined || (Array.isArray(v.checkHistory) && v.checkHistory.every((item: unknown) => record(item) && strings(item, ["id", "note"]) && (item.date === null || typeof item.date === "string"))));

export function isDashboardState(value: unknown): value is DashboardState {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.broadcasts) || !Array.isArray(value.customers)) return false;
  return value.customers.every((c) => strings(c, ["id", "instagramId", "updatedAt"]) && delivery(c.delivery) && customerState(c)) && value.broadcasts.every((b) => {
    if (!strings(b, ["id", "title", "memo", "memoDraft", "orderDraft", "createdAt", "updatedAt"]) || !Array.isArray(b.settlements) || !Array.isArray(b.orders) || !Array.isArray(b.settlementErrors)) return false;
    return b.settlements.every((s: unknown) => record(s) && strings(s, ["id", "instagramId"]) && typeof s.total === "number" && Number.isFinite(s.total) && typeof s.quantity === "number" && Array.isArray(s.items) && s.items.every((i: unknown) => typeof i === "string"))
      && b.settlementErrors.every((e: unknown) => record(e) && strings(e, ["text", "message"]) && typeof e.line === "number")
      && b.orders.every((o: unknown) => record(o) && strings(o, ["id", "instagramId", "sourceText"]) && (o.shippingMessage === undefined || typeof o.shippingMessage === "string") && ["WAITING", "READY", "COMPLETED"].includes(String(o.status)) && typeof o.registrationConfirmed === "boolean" && (o.settlementId === null || typeof o.settlementId === "string") && (o.delivery === null || delivery(o.delivery)) && Array.isArray(o.extractionWarnings) && o.extractionWarnings.every((w: unknown) => typeof w === "string") && (o.conflict === null || (record(o.conflict) && typeof o.conflict.customerId === "string" && delivery(o.conflict.previous) && delivery(o.conflict.incoming))));
  });
}

export function loadMockState(storage: StoragePort, key = STORAGE_KEY): DashboardState {
  let raw: string | null;
  try { raw = storage.getItem(key); }
  catch (error) { throw dashboardStorageFailure(error, "read", key); }
  if (!raw) return createMockState();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("V2 저장 데이터가 손상되었습니다. 데모 초기화로 복구할 수 있습니다."); }
  if (!isDashboardState(value)) throw new Error("V2 저장 데이터 형식이 다릅니다. 데모 초기화로 복구할 수 있습니다.");
  return value;
}

export function saveMockState(storage: StoragePort, state: DashboardState, key = STORAGE_KEY) {
  if (!isDashboardState(state)) throw new Error("저장 데이터 검증에 실패했습니다.");
  const serialized = JSON.stringify(state);
  const payloadBytes = new TextEncoder().encode(serialized).byteLength;
  try { storage.setItem(key, serialized); }
  catch (error) { throw dashboardStorageFailure(error, "write", key, payloadBytes); }
}

function withoutUpdatedAt<T extends { updatedAt: string }>(record: T) {
  const { updatedAt: _updatedAt, ...content } = record;
  return content;
}

// A timestamp by itself is not a user change. Ignore it before deciding
// whether to persist, so navigation and duplicate UI events cannot create a
// misleading "last modified" update or a remote write.
export function hasMeaningfulDashboardChange(before: DashboardState, after: DashboardState) {
  if (before === after) return false;
  return JSON.stringify({
    version: before.version,
    broadcasts: before.broadcasts.map(withoutUpdatedAt),
    customers: before.customers.map(withoutUpdatedAt),
  }) !== JSON.stringify({
    version: after.version,
    broadcasts: after.broadcasts.map(withoutUpdatedAt),
    customers: after.customers.map(withoutUpdatedAt),
  });
}

import { canonicalInstagramId } from "./shipping-parser";
import { isDashboardState } from "./repository";
import type { Broadcast, Customer, DashboardState } from "./types";

export const REMOTE_MIGRATION_KEY = "unclozet-dashboard-v2-remote-migration-v1";
export const REMOTE_PENDING_KEY = "unclozet-dashboard-v2-remote-pending-v1";

type MigrationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// 브라우저는 Supabase에 직접 접근하지 않는다. 관리자 쿠키가 있어야 통과하는 /api/dashboard/state를 거친다.

export type RemoteWorkspace = { mode: "remote"; state: DashboardState; updatedAt: string } | { mode: "local" };

export class RemoteDashboardError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); this.name = "RemoteDashboardError"; }
}

async function call<T>(init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/dashboard/state", { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new RemoteDashboardError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", "NETWORK", 0);
  }
  const body = await response.json().catch(() => null) as ({ error?: string; code?: string } & T) | null;
  if (!response.ok) throw new RemoteDashboardError(body?.error ?? `요청에 실패했어요. (${response.status})`, body?.code ?? "SERVER", response.status);
  return body as T;
}

export async function fetchRemoteDashboardState(): Promise<RemoteWorkspace> {
  const body = await call<RemoteWorkspace>();
  if (body.mode === "remote" && !isDashboardState(body.state)) throw new RemoteDashboardError("Supabase의 V2 데이터 형식이 올바르지 않아요.", "INVALID", 200);
  return body;
}

/** baseUpdatedAt 이후 다른 곳에서 저장했으면 code "CONFLICT"로 실패한다. */
export async function saveRemoteDashboardState(state: DashboardState, baseUpdatedAt: string) {
  if (!isDashboardState(state)) throw new Error("저장할 V2 데이터 형식이 올바르지 않습니다.");
  return call<{ updatedAt: string }>({ method: "PUT", body: JSON.stringify({ state, baseUpdatedAt }) });
}

function newer<T extends { updatedAt: string }>(left: T, right: T) {
  return right.updatedAt >= left.updatedAt ? right : left;
}

function mergeBroadcasts(remote: Broadcast[], local: Broadcast[]) {
  const byId = new Map(remote.map((broadcast) => [broadcast.id, broadcast]));
  for (const broadcast of local) {
    const previous = byId.get(broadcast.id);
    byId.set(broadcast.id, previous ? newer(previous, broadcast) : broadcast);
  }
  return [...byId.values()];
}

function mergeCustomer(remote: Customer, local: Customer): Customer {
  const latest = newer(remote, local);
  const checks = new Map((remote.checkHistory ?? []).map((check) => [check.id, check]));
  for (const check of local.checkHistory ?? []) checks.set(check.id, check);
  return {
    ...latest,
    id: remote.id,
    lastOrderedAt: [remote.lastOrderedAt, local.lastOrderedAt].filter((value): value is string => Boolean(value)).sort().at(-1),
    legacyCheckCount: Math.max(remote.legacyCheckCount ?? 0, local.legacyCheckCount ?? 0),
    checkHistory: [...checks.values()],
  };
}

function mergeCustomers(remote: Customer[], local: Customer[]) {
  const byInstagramId = new Map(remote.map((customer) => [canonicalInstagramId(customer.instagramId), customer]));
  const mergedAway = new Set(remote.flatMap((customer) => (customer.mergedCustomers ?? []).map((merged) => canonicalInstagramId(merged.instagramId))));
  for (const customer of local) {
    const key = canonicalInstagramId(customer.instagramId);
    if (mergedAway.has(key)) continue;
    const previous = byInstagramId.get(key);
    byInstagramId.set(key, previous ? mergeCustomer(previous, customer) : customer);
  }
  return [...byInstagramId.values()];
}

export function mergeDashboardStates(remote: DashboardState, local: DashboardState): DashboardState {
  return {
    version: 2,
    broadcasts: mergeBroadcasts(remote.broadcasts, local.broadcasts),
    customers: mergeCustomers(remote.customers, local.customers),
  };
}

export function remoteSavePending(storage: MigrationStorage) {
  return storage.getItem(REMOTE_PENDING_KEY) === "pending";
}

export function clearRemoteSavePending(storage: MigrationStorage) {
  storage.removeItem(REMOTE_PENDING_KEY);
}

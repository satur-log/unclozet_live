import { canonicalInstagramId } from "./shipping-parser";
import { isDashboardState } from "./repository";
import { sortBroadcasts, type DashboardChanges, type RowVersions } from "./row-sync";
import type { Broadcast, Customer, DashboardState } from "./types";

export const REMOTE_MIGRATION_KEY = "unclozet-dashboard-v2-remote-migration-v1";
export const REMOTE_PENDING_KEY = "unclozet-dashboard-v2-remote-pending-v1";

type MigrationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// 브라우저는 Supabase에 직접 접근하지 않는다. 관리자 쿠키가 있어야 통과하는 /api/dashboard/*를 거친다.
// 방송은 페이지(15건)로 나눠 동시에 받고, 저장은 바뀐 방송·고객 행만 보낸다(Vercel 요청·응답 한도 4.5MB 회피).

export type RemoteWorkspace = { mode: "remote"; state: DashboardState; versions: RowVersions; project: string | null } | { mode: "local" };

export class RemoteDashboardError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); this.name = "RemoteDashboardError"; }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new RemoteDashboardError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", "NETWORK", 0);
  }
  const body = await response.json().catch(() => null) as ({ error?: string; code?: string } & T) | null;
  if (!response.ok) throw new RemoteDashboardError(body?.error ?? `요청에 실패했어요. (${response.status})`, body?.code ?? "SERVER", response.status);
  return body as T;
}

type LocalReply = { mode: "local" };
type CustomersReply = { mode: "remote"; project: string | null; customers: Customer[]; versions: Record<string, number> };
type BroadcastPageReply = { mode: "remote"; project: string | null; broadcasts: Broadcast[]; versions: Record<string, number>; total: number; pageSize: number };

const broadcastPage = (offset: number) => call<BroadcastPageReply | LocalReply>(`/api/dashboard/state?part=broadcasts&offset=${offset}`);

export async function fetchRemoteDashboardState(): Promise<RemoteWorkspace> {
  const [customers, first] = await Promise.all([call<CustomersReply | LocalReply>("/api/dashboard/state?part=customers"), broadcastPage(0)]);
  if (customers.mode === "local" || first.mode === "local") return { mode: "local" };
  const rest: BroadcastPageReply[] = [];
  const offsets: number[] = [];
  for (let offset = first.pageSize; offset < first.total; offset += first.pageSize) offsets.push(offset);
  for (const page of await Promise.all(offsets.map(broadcastPage))) {
    if (page.mode === "local") return { mode: "local" };
    rest.push(page);
  }
  const pages = [first, ...rest];
  // 받는 사이에 방송이 추가·삭제되면 페이지 경계가 밀려 겹치거나 빠질 수 있다. 겹침은 id로 걸러내고, 수가 모자라면 다시 받는다.
  const byId = new Map<string, Broadcast>();
  const broadcastVersions: Record<string, number> = {};
  for (const page of pages) for (const broadcast of page.broadcasts) { byId.set(broadcast.id, broadcast); broadcastVersions[broadcast.id] = page.versions[broadcast.id]; }
  const total = Math.max(...pages.map((page) => page.total));
  if (byId.size < total) throw new RemoteDashboardError("방송 목록이 바뀌는 중이라 다시 불러와야 해요. 잠시 후 다시 시도해 주세요.", "RETRY", 0);
  const state: DashboardState = { version: 2, broadcasts: sortBroadcasts([...byId.values()]), customers: customers.customers };
  if (!isDashboardState(state)) throw new RemoteDashboardError("Supabase의 V2 데이터 형식이 올바르지 않아요.", "INVALID", 200);
  return { mode: "remote", state, versions: { broadcasts: broadcastVersions, customers: customers.versions }, project: first.project };
}

/** 바뀐 행만 저장한다. 다른 곳에서 먼저 고친 행이 있으면 code "CONFLICT"로 실패한다. */
export async function saveRemoteDashboardChanges(changes: DashboardChanges) {
  return call<{ versions: RowVersions }>("/api/dashboard/commit", { method: "POST", body: JSON.stringify({ changes }) });
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

import { canonicalInstagramId } from "./shipping-parser";
import { isDashboardState } from "./repository";
import { BROADCAST_PAGE_SIZE, sortBroadcasts, type DashboardChanges, type RowVersions } from "./row-sync";
import type { Broadcast, Customer, DashboardState } from "./types";
import type { BroadcastSummary } from "./summary";

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
export type CustomersReply = { mode: "remote"; project: string | null; customers: Customer[]; versions: Record<string, number> };
export type BroadcastPageReply = { mode: "remote"; project: string | null; broadcasts: Broadcast[]; versions: Record<string, number>; total: number; pageSize: number };
export type SummariesReply = { mode: "remote"; project: string | null; summaries: BroadcastSummary[] };
export type SingleBroadcastReply = { mode: "remote"; broadcast: Broadcast | null; version: number | null };

const broadcastPage = (offset: number, limit = BROADCAST_PAGE_SIZE) => call<BroadcastPageReply | LocalReply>(`/api/dashboard/state?part=broadcasts&offset=${offset}&limit=${limit}`);

/**
 * 화면에 필요한 것부터 받는다. 요청은 모두 동시에 시작하고, 각 부분은 도착하는 대로 쓸 수 있다.
 * - summaries: 방송 목록 화면용 요약(방송 내용 없이, 가장 빨리 온다)
 * - firstPage: 최신 방송 firstLimit건
 * - broadcast: 상세 화면의 방송 한 건
 * - full: 전체(고객 + 모든 방송). 수정·저장은 이것을 받은 뒤에만 한다.
 */
export type DashboardLoad = {
  customers: Promise<CustomersReply | LocalReply>;
  summaries: Promise<SummariesReply | LocalReply> | null;
  firstPage: Promise<BroadcastPageReply | LocalReply>;
  broadcast: Promise<SingleBroadcastReply | LocalReply> | null;
  full: Promise<RemoteWorkspace>;
};

export function startDashboardLoad({ firstLimit = BROADCAST_PAGE_SIZE, broadcastId, summaries: wantSummaries = false }: { firstLimit?: number; broadcastId?: string; summaries?: boolean } = {}): DashboardLoad {
  const summaries = wantSummaries ? call<SummariesReply | LocalReply>("/api/dashboard/state?part=summaries") : null;
  const customers = call<CustomersReply | LocalReply>("/api/dashboard/state?part=customers");
  const firstPage = broadcastPage(0, firstLimit);
  const broadcast = broadcastId ? call<SingleBroadcastReply | LocalReply>(`/api/dashboard/state?part=broadcast&id=${encodeURIComponent(broadcastId)}`) : null;
  // 화면이 먼저 쓰지 않고 넘어가도 "처리되지 않은 오류"로 남지 않게 한다(full에서 다시 확인한다).
  for (const early of [summaries, customers, firstPage, broadcast]) early?.catch(() => undefined);
  const full = (async (): Promise<RemoteWorkspace> => {
    const [customerReply, first] = await Promise.all([customers, firstPage]);
    if (customerReply.mode === "local" || first.mode === "local") return { mode: "local" };
    const offsets: number[] = [];
    for (let offset = first.broadcasts.length < first.pageSize ? first.total : first.pageSize; offset < first.total; offset += BROADCAST_PAGE_SIZE) offsets.push(offset);
    const rest: BroadcastPageReply[] = [];
    for (const page of await Promise.all(offsets.map((offset) => broadcastPage(offset)))) {
      if (page.mode === "local") return { mode: "local" };
      rest.push(page);
    }
    const pages = [first, ...rest];
    // 받는 사이에 방송이 추가·삭제되면 페이지 경계가 밀려 겹치거나 빠질 수 있다. 겹침은 id로 걸러내고, 수가 모자라면 다시 받는다.
    const byId = new Map<string, Broadcast>();
    const broadcastVersions: Record<string, number> = {};
    for (const page of pages) for (const item of page.broadcasts) { byId.set(item.id, item); broadcastVersions[item.id] = page.versions[item.id]; }
    const total = Math.max(...pages.map((page) => page.total));
    if (byId.size < total) throw new RemoteDashboardError("방송 목록이 바뀌는 중이라 다시 불러와야 해요. 잠시 후 다시 시도해 주세요.", "RETRY", 0);
    const state: DashboardState = { version: 2, broadcasts: sortBroadcasts([...byId.values()]), customers: customerReply.customers };
    if (!isDashboardState(state)) throw new RemoteDashboardError("Supabase의 V2 데이터 형식이 올바르지 않아요.", "INVALID", 200);
    return { mode: "remote", state, versions: { broadcasts: broadcastVersions, customers: customerReply.versions }, project: first.project };
  })();
  return { summaries, customers, firstPage, broadcast, full };
}

export function fetchRemoteDashboardState(): Promise<RemoteWorkspace> {
  return startDashboardLoad().full;
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

import { canonicalInstagramId } from "./shipping-parser";
import { isDashboardState } from "./repository";
import type { Broadcast, Customer, DashboardState } from "./types";

export const REMOTE_WORKSPACE_ID = "main";
export const REMOTE_MIGRATION_KEY = "unclozet-dashboard-v2-remote-migration-v1";
export const REMOTE_PENDING_KEY = "unclozet-dashboard-v2-remote-pending-v1";

type MigrationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

function headers(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

export function hasRemoteDashboardConfig() {
  return Boolean(supabaseConfig());
}

export async function fetchRemoteDashboardState(): Promise<DashboardState | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const response = await fetch(
    `${config.url}/rest/v1/dashboard_v2_workspaces?id=eq.${REMOTE_WORKSPACE_ID}&select=state&limit=1`,
    { headers: headers(config.key), cache: "no-store" },
  );
  if (!response.ok) throw new Error("공유 데이터를 불러오지 못했습니다.");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const state = (rows[0] as { state?: unknown }).state;
  if (!isDashboardState(state)) throw new Error("Supabase의 V2 데이터 형식이 올바르지 않습니다.");
  return state;
}

export async function saveRemoteDashboardState(state: DashboardState) {
  const config = supabaseConfig();
  if (!config) return;
  if (!isDashboardState(state)) throw new Error("저장할 V2 데이터 형식이 올바르지 않습니다.");
  const timestamp = new Date().toISOString();
  const response = await fetch(`${config.url}/rest/v1/dashboard_v2_workspaces?on_conflict=id`, {
    method: "POST",
    headers: {
      ...headers(config.key),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ id: REMOTE_WORKSPACE_ID, state, updated_at: timestamp }),
  });
  if (!response.ok) throw new Error("Supabase에 공유 데이터를 저장하지 못했습니다.");
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
  for (const customer of local) {
    const key = canonicalInstagramId(customer.instagramId);
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

export function remoteMigrationCompleted(storage: MigrationStorage) {
  return storage.getItem(REMOTE_MIGRATION_KEY) === "completed";
}

export function markRemoteMigrationCompleted(storage: MigrationStorage) {
  storage.setItem(REMOTE_MIGRATION_KEY, "completed");
}

export function remoteSavePending(storage: MigrationStorage) {
  return storage.getItem(REMOTE_PENDING_KEY) === "pending";
}

export function markRemoteSavePending(storage: MigrationStorage) {
  storage.setItem(REMOTE_PENDING_KEY, "pending");
}

export function clearRemoteSavePending(storage: MigrationStorage) {
  storage.removeItem(REMOTE_PENDING_KEY);
}

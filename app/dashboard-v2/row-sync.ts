import type { Broadcast, Customer, DashboardState } from "./types";

// V2 대시보드를 Supabase 행(방송 1행, 고객 1행) 단위로 주고받기 위한 순수 함수(브라우저·서버 공용).
// 화면은 지금처럼 DashboardState 전체에 model 함수를 적용하고, 저장할 때만 바뀐 행을 골라 보낸다.

export type RowVersions = { broadcasts: Record<string, number>; customers: Record<string, number> };
export type RowChange<T> = { op: "put"; id: string; data: T; version: number | null } | { op: "delete"; id: string; version: number | null };
export type DashboardChanges = { broadcasts: RowChange<Broadcast>[]; customers: RowChange<Customer>[] };

export const emptyRowVersions = (): RowVersions => ({ broadcasts: {}, customers: {} });
export const hasDashboardChanges = (changes: DashboardChanges) => changes.broadcasts.length > 0 || changes.customers.length > 0;

/** 한 번에 받는 방송 수. 방송 1건이 커도(최대 ~100KB) 응답이 Vercel 한도(4.5MB)에 한참 못 미치게. */
export const BROADCAST_PAGE_SIZE = 15;

function diffRows<T extends { id: string }>(base: T[], next: T[], versions: Record<string, number>): RowChange<T>[] {
  const changes: RowChange<T>[] = [];
  const before = new Map(base.map((row) => [row.id, row]));
  for (const row of next) {
    const previous = before.get(row.id);
    if (previous && (previous === row || JSON.stringify(previous) === JSON.stringify(row))) continue;
    changes.push({ op: "put", id: row.id, data: row, version: previous ? versions[row.id] ?? null : null });
  }
  const nextIds = new Set(next.map((row) => row.id));
  for (const row of base) if (!nextIds.has(row.id)) changes.push({ op: "delete", id: row.id, version: versions[row.id] ?? null });
  return changes;
}

/** base(서버에 저장된 모습) → next(화면) 사이에 바뀐 방송·고객 행만 고른다. */
export function diffDashboard(base: DashboardState, next: DashboardState, versions: RowVersions): DashboardChanges {
  return {
    broadcasts: diffRows(base.broadcasts, next.broadcasts, versions.broadcasts),
    customers: diffRows(base.customers, next.customers, versions.customers),
  };
}

/** 서버가 돌려준 새 버전을 반영한다. 지운 행의 버전은 버린다. */
export function applyRowVersions(versions: RowVersions, changes: DashboardChanges, updated: Partial<RowVersions>): RowVersions {
  const broadcasts = { ...versions.broadcasts, ...updated.broadcasts };
  const customers = { ...versions.customers, ...updated.customers };
  for (const change of changes.broadcasts) if (change.op === "delete") delete broadcasts[change.id];
  for (const change of changes.customers) if (change.op === "delete") delete customers[change.id];
  return { broadcasts, customers };
}

/** 방송 목록 순서(최신 먼저). 서버 페이지 순서와 같다. */
export function sortBroadcasts(broadcasts: Broadcast[]) {
  return [...broadcasts].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

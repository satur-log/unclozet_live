import { isDashboardState } from "../repository";
import type { DashboardChanges, RowVersions } from "../row-sync";
import type { Broadcast, Customer } from "../types";
import { broadcastSummary, isBroadcastSummary, type BroadcastSummary } from "../summary";

// V2 대시보드 저장소(서버 전용). service_role 키로만 Supabase에 접근한다.
// 방송·고객을 행 단위 표(dashboard_v2_broadcasts / dashboard_v2_customers)에 저장한다.
// 예전 dashboard_v2_workspaces(main 한 행 JSON)는 최초 1회 이전용으로만 읽는다(백업으로 남는다).

export class WorkspaceConflictError extends Error {}
export class WorkspaceConfigError extends Error {}

type Config = { rest: string; headers: Record<string, string> };

function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV === "production") throw new WorkspaceConfigError("대시보드 저장소가 연결되지 않았어요. Vercel 환경변수 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요.");
    return null;
  }
  const auth: Record<string, string> = key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  return { rest: `${url}/rest/v1`, headers: { ...auth, "Content-Type": "application/json" } };
}

/** 연결된 Supabase 프로젝트 ref(공개값). Preview가 테스트 DB를 쓰는지 확인하는 용도. */
export function workspaceProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/^https:\/\/([a-z0-9]+)\./i)?.[1] ?? null;
}

/** null = 개발 환경에서 Supabase 미설정(브라우저 로컬 모드로 동작) */
export const workspaceConfigured = () => config() !== null;

async function call<T>(c: Config, pathAndQuery: string, init: RequestInit = {}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${c.rest}${pathAndQuery}`, { ...init, headers: { ...c.headers, ...init.headers }, cache: "no-store" });
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? `Supabase 요청 실패 (${response.status})`;
    if (message.startsWith("DASH_CONFLICT")) throw new WorkspaceConflictError("다른 곳에서 먼저 저장한 내용이 있어요.");
    if (/summary/.test(message) && /column|does not exist/i.test(message)) throw new WorkspaceConfigError("Supabase에 방송 요약 칸이 없어요. supabase/dashboard_v2_summary.sql을 SQL Editor에서 실행해 주세요.");
    if (response.status === 404 && /dashboard_v2_/.test(message)) throw new WorkspaceConfigError("Supabase에 새 대시보드 표가 없어요. supabase/dashboard_v2_rows.sql을 SQL Editor에서 실행해 주세요.");
    throw new Error(message);
  }
  return { body: body as T, response };
}

// 서버 인스턴스마다 한 번만 확인한다(이전 함수는 이미 옮겼으면 바로 끝난다).
let migrated: Promise<void> | null = null;
function ensureMigrated(c: Config) {
  migrated ??= call(c, "/rpc/dashboard_v2_migrate_from_workspace", { method: "POST", body: "{}" }).then(() => undefined, (error) => { migrated = null; throw error; });
  return migrated;
}

type Row<T> = { data: T; version: number };

function validBroadcast(value: unknown): value is Broadcast {
  return isDashboardState({ version: 2, broadcasts: [value], customers: [] });
}
function validCustomer(value: unknown): value is Customer {
  return isDashboardState({ version: 2, broadcasts: [], customers: [value] });
}

export async function readCustomers(): Promise<{ customers: Customer[]; versions: Record<string, number> } | null> {
  const c = config();
  if (!c) return null;
  await ensureMigrated(c);
  const customers: Customer[] = [];
  const versions: Record<string, number> = {};
  // PostgREST는 한 번에 최대 1000행만 준다. 고객이 늘어도 다 받도록 나눠 받는다.
  for (let from = 0; ; from += 1000) {
    const { body } = await call<Row<Customer>[]>(c, "/dashboard_v2_customers?select=data,version&order=id.asc", { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    for (const row of body) {
      if (!validCustomer(row.data)) throw new Error("Supabase의 고객 데이터 형식이 올바르지 않아요.");
      customers.push(row.data);
      versions[row.data.id] = row.version;
    }
    if (body.length < 1000) return { customers, versions };
  }
}

export async function readBroadcastPage(offset: number, limit: number): Promise<{ broadcasts: Broadcast[]; versions: Record<string, number>; total: number } | null> {
  const c = config();
  if (!c) return null;
  await ensureMigrated(c);
  const { body, response } = await call<Row<Broadcast>[]>(c, "/dashboard_v2_broadcasts?select=data,version&order=created_at.desc,id.asc", {
    headers: { Range: `${offset}-${offset + limit - 1}`, "Range-Unit": "items", Prefer: "count=exact" },
  });
  const total = Number(response.headers.get("content-range")?.split("/")[1] ?? body.length);
  const versions: Record<string, number> = {};
  for (const row of body) {
    if (!validBroadcast(row.data)) throw new Error("Supabase의 방송 데이터 형식이 올바르지 않아요.");
    versions[row.data.id] = row.version;
  }
  return { broadcasts: body.map((row) => row.data), versions, total: Number.isFinite(total) ? total : body.length };
}

/**
 * 방송 목록 화면용 요약 전체(최신 먼저). 방송 내용(data)은 받지 않아 방송이 많아도 몇 KB다.
 * 요약이 비어 있거나 계산 방식이 바뀐 방송은 그 방송만 받아 계산하고, 그 버전 그대로일 때만 summary 칸을 채운다
 * (data·version은 바꾸지 않는다. 그 사이 다른 곳에서 고쳤으면 채우지 않고 다음에 다시 계산한다).
 */
export async function readBroadcastSummaries(): Promise<{ summaries: BroadcastSummary[] } | null> {
  const c = config();
  if (!c) return null;
  await ensureMigrated(c);
  const rows: { id: string; summary: unknown; version: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { body } = await call<typeof rows>(c, "/dashboard_v2_broadcasts?select=id,summary,version&order=created_at.desc,id.asc", { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    rows.push(...body);
    if (body.length < 1000) break;
  }
  const missing = rows.filter((row) => !isBroadcastSummary(row.summary) || row.summary.id !== row.id).map((row) => row.id);
  const filled = new Map<string, BroadcastSummary>();
  for (let index = 0; index < missing.length; index += 20) {
    const ids = missing.slice(index, index + 20).map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",");
    const { body } = await call<{ id: string; data: unknown; version: number }[]>(c, `/dashboard_v2_broadcasts?select=id,data,version&id=in.(${encodeURIComponent(ids)})`);
    await Promise.all(body.map(async (row) => {
      if (!validBroadcast(row.data)) throw new Error("Supabase의 방송 데이터 형식이 올바르지 않아요.");
      const summary = broadcastSummary(row.data);
      filled.set(row.id, summary);
      await call(c, `/dashboard_v2_broadcasts?id=eq.${encodeURIComponent(row.id)}&version=eq.${row.version}`, { method: "PATCH", body: JSON.stringify({ summary }), headers: { Prefer: "return=minimal" } }).catch(() => undefined);
    }));
  }
  const summaries = rows.map((row) => filled.get(row.id) ?? row.summary).filter(isBroadcastSummary);
  return { summaries };
}

/** 방송 한 건(상세 화면을 먼저 그리려고). 없으면 null. */
export async function readBroadcast(id: string): Promise<{ broadcast: Broadcast; version: number } | null | undefined> {
  const c = config();
  if (!c) return undefined;
  await ensureMigrated(c);
  const { body } = await call<Row<Broadcast>[]>(c, `/dashboard_v2_broadcasts?select=data,version&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = body[0];
  if (!row) return null;
  if (!validBroadcast(row.data)) throw new Error("Supabase의 방송 데이터 형식이 올바르지 않아요.");
  return { broadcast: row.data, version: row.version };
}

/** 바뀐 행 묶음을 한 트랜잭션으로 저장한다. 다른 곳에서 먼저 고친 행이 있으면 WorkspaceConflictError. */
export async function commitDashboard(changes: DashboardChanges): Promise<RowVersions> {
  const c = config();
  if (!c) throw new WorkspaceConfigError("Supabase가 연결되지 않아 저장할 수 없어요.");
  await ensureMigrated(c);
  for (const change of changes.broadcasts) if (change.op === "put" && (change.id !== change.data.id || !validBroadcast(change.data))) throw new Error("저장할 방송 데이터 형식이 올바르지 않아요.");
  for (const change of changes.customers) if (change.op === "put" && (change.id !== change.data.id || !validCustomer(change.data))) throw new Error("저장할 고객 데이터 형식이 올바르지 않아요.");
  // 방송을 넣거나 고칠 때 목록용 요약도 같은 트랜잭션에 함께 저장한다.
  const payload = { ...changes, broadcasts: changes.broadcasts.map((change) => change.op === "put" ? { ...change, summary: broadcastSummary(change.data) } : change) };
  const { body } = await call<Partial<RowVersions>>(c, "/rpc/dashboard_v2_commit", { method: "POST", body: JSON.stringify({ changes: payload }) });
  return { broadcasts: body?.broadcasts ?? {}, customers: body?.customers ?? {} };
}

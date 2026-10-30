import { promises as fs } from "node:fs";
import path from "node:path";
import { GroupBuyError } from "../model";
import type { Changes, Versions } from "../sync";
import type { GbOrder, GroupBuy, GroupBuyState, LookupLock } from "../types";

// 공구 저장소(서버 전용). SUPABASE_SERVICE_ROLE_KEY가 있으면 Supabase, 없으면 개발용 로컬 파일.
// service_role 키는 이 파일(서버)에서만 읽는다. 브라우저 코드에서 import하지 않는다.

export type Snapshot = { state: GroupBuyState; versions: Versions };

export interface Backend {
  kind: "supabase" | "file";
  snapshot(): Promise<Snapshot>;
  commit(changes: Changes): Promise<Versions>;
  nextOrderSeq(): Promise<number>;
  reserveOrderSeq(minimum: number): Promise<void>;
  groupBuyById(id: string): Promise<GroupBuy | null>;
  groupBuyBySlug(slug: string): Promise<GroupBuy | null>;
  groupBuysByIds(ids: string[]): Promise<GroupBuy[]>;
  ordersByPhone(phone: string): Promise<GbOrder[]>;
  orderByToken(token: string): Promise<GbOrder | null>;
  lookupLock(phone: string): Promise<LookupLock | null>;
  uploadImage(bytes: Uint8Array, contentType: string): Promise<string>;
}

/** 다른 곳에서 먼저 고친 행을 덮어쓰려 할 때 */
export class ConflictError extends Error {}
/** 운영 환경에 Supabase 설정이 없을 때 */
export class ConfigError extends Error {}

// ── Supabase ─────────────────────────────────────────────

function supabaseBackend(url: string, key: string): Backend {
  const rest = `${url}/rest/v1`;
  // 예전 service_role 키(JWT, eyJ…)는 Authorization에도 넣고, 새 비밀 키(sb_secret_…)는 apikey만 보낸다.
  const auth: Record<string, string> = key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  const headers = { ...auth, "Content-Type": "application/json" };

  async function call<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${rest}${pathAndQuery}`, { ...init, headers: { ...headers, ...init.headers }, cache: "no-store" });
    const text = await response.text();
    const body = text ? JSON.parse(text) as unknown : null;
    if (!response.ok) {
      const message = (body as { message?: string } | null)?.message ?? `Supabase 요청 실패 (${response.status})`;
      if (message.startsWith("GB_CONFLICT")) throw new ConflictError(message);
      if ((body as { code?: string } | null)?.code === "23505") {
        if (message.includes("slug")) throw new GroupBuyError("INVALID", "이미 다른 공구가 쓰는 주소예요. 주소를 바꿔주세요.");
        throw new ConflictError(message);
      }
      if (response.status === 404 && message.includes("gb_")) throw new ConfigError("Supabase에 공구 표가 없어요. supabase/group_buy.sql을 SQL Editor에서 실행해 주세요.");
      throw new Error(message);
    }
    return body as T;
  }
  const rpc = <T>(name: string, args: Record<string, unknown> = {}) => call<T>(`/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  const rows = <T>(table: string, query: string) => call<T[]>(`/${table}?${query}`);
  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

  return {
    kind: "supabase",
    async snapshot() {
      type Raw = { groupBuys: { data: GroupBuy; version: number }[]; orders: { data: GbOrder; version: number }[]; stockLogs: GroupBuyState["stockLogs"]; lookupLocks: GroupBuyState["lookupLocks"]; orderSeq: number };
      const raw = await rpc<Raw>("gb_snapshot");
      return {
        state: { version: 1, groupBuys: raw.groupBuys.map((row) => row.data), orders: raw.orders.map((row) => row.data), stockLogs: raw.stockLogs, lookupLocks: raw.lookupLocks, orderSeq: Number(raw.orderSeq) },
        versions: { groupBuys: Object.fromEntries(raw.groupBuys.map((row) => [row.data.id, row.version])), orders: Object.fromEntries(raw.orders.map((row) => [row.data.id, row.version])) },
      };
    },
    async commit(changes) {
      const updated = await rpc<Versions>("gb_commit", { changes });
      return { groupBuys: updated.groupBuys ?? {}, orders: updated.orders ?? {} };
    },
    async nextOrderSeq() { return Number(await rpc<number>("gb_next_order_seq")); },
    async reserveOrderSeq(minimum) { await rpc("gb_reserve_order_seq", { minimum }); },
    async groupBuyById(id) { return (await rows<{ data: GroupBuy }>("gb_group_buys", `id=${eq(id)}&select=data`))[0]?.data ?? null; },
    async groupBuyBySlug(slug) { return (await rows<{ data: GroupBuy }>("gb_group_buys", `slug=${eq(slug)}&select=data`))[0]?.data ?? null; },
    async groupBuysByIds(ids) {
      if (!ids.length) return [];
      return (await rows<{ data: GroupBuy }>("gb_group_buys", `id=in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})&select=data`)).map((row) => row.data);
    },
    async ordersByPhone(phone) { return (await rows<{ data: GbOrder }>("gb_orders", `phone=${eq(phone)}&select=data&order=created_at.desc`)).map((row) => row.data); },
    async orderByToken(token) { return (await rows<{ data: GbOrder }>("gb_orders", `lookup_token=${eq(token)}&select=data`))[0]?.data ?? null; },
    async lookupLock(phone) { return (await rows<{ data: LookupLock }>("gb_lookup_locks", `phone=${eq(phone)}&select=data`))[0]?.data ?? null; },
    async uploadImage(bytes, contentType) {
      const name = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"}`;
      const response = await fetch(`${url}/storage/v1/object/gb-images/${name}`, { method: "POST", headers: { ...auth, "Content-Type": contentType }, body: Buffer.from(bytes) });
      if (!response.ok) throw new Error(`이미지를 올리지 못했어요 (${response.status}). Supabase Storage에 gb-images 버킷이 있는지 확인해 주세요.`);
      return `${url}/storage/v1/object/public/gb-images/${name}`;
    },
  };
}

// ── 개발용 로컬 파일 (.data/group-buy-dev.json) ───────────
// Supabase 키 없이 내 컴퓨터에서 같은 흐름을 시험하기 위한 것. gb_commit과 같은 규칙으로 동작한다.

type FileDb = { groupBuys: Record<string, { data: GroupBuy; version: number }>; orders: Record<string, { data: GbOrder; version: number }>; stockLogs: Record<string, GroupBuyState["stockLogs"][number]>; lookupLocks: Record<string, LookupLock>; orderSeq: number };
const emptyDb = (): FileDb => ({ groupBuys: {}, orders: {}, stockLogs: {}, lookupLocks: {}, orderSeq: 0 });

/** gb_commit(SQL)과 같은 규칙. 하나라도 충돌하면 아무것도 바꾸지 않는다. */
export function applyChangesToDb(source: FileDb, changes: Changes): { db: FileDb; versions: Versions } {
  const db: FileDb = structuredClone(source);
  const versions: Versions = { groupBuys: {}, orders: {} };
  for (const item of changes.groupBuys) {
    if (item.op === "delete") { delete db.groupBuys[item.id]; continue; }
    const current = db.groupBuys[item.id];
    if (item.version == null ? current : !current || current.version !== item.version) throw new ConflictError(`GB_CONFLICT group_buy ${item.id}`);
    if (Object.entries(db.groupBuys).some(([id, row]) => id !== item.id && row.data.slug === item.slug)) throw new GroupBuyError("INVALID", "이미 다른 공구가 쓰는 주소예요. 주소를 바꿔주세요.");
    const version = (current?.version ?? 0) + 1;
    db.groupBuys[item.id] = { data: item.data, version };
    versions.groupBuys[item.id] = version;
  }
  for (const item of changes.orders) {
    if (item.op === "delete") { delete db.orders[item.id]; continue; }
    const current = db.orders[item.id];
    if (item.version == null ? current : !current || current.version !== item.version) throw new ConflictError(`GB_CONFLICT order ${item.id}`);
    if (Object.entries(db.orders).some(([id, row]) => id !== item.id && (row.data.orderNo === item.orderNo || row.data.lookupToken === item.lookupToken))) throw new ConflictError(`GB_CONFLICT order_no ${item.orderNo}`);
    const version = (current?.version ?? 0) + 1;
    db.orders[item.id] = { data: item.data, version };
    versions.orders[item.id] = version;
  }
  for (const item of changes.stockLogs) {
    if (item.op === "delete") delete db.stockLogs[item.id];
    else db.stockLogs[item.id] ??= item.data;
  }
  for (const item of changes.lookupLocks) {
    if (item.op === "delete") delete db.lookupLocks[item.phone];
    else db.lookupLocks[item.phone] = item.data;
  }
  return { db, versions };
}

function fileBackend(file: string): Backend {
  let chain: Promise<unknown> = Promise.resolve();
  // 요청이 겹쳐도 파일을 한 번에 하나씩 읽고 쓴다(DB 트랜잭션 흉내).
  const serial = <T>(task: () => Promise<T>) => { const run = chain.then(task, task); chain = run.catch(() => undefined); return run; };
  async function read(): Promise<FileDb> {
    try { return { ...emptyDb(), ...JSON.parse(await fs.readFile(file, "utf8")) as FileDb }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDb(); throw error; }
  }
  async function write(db: FileDb) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(db));
    await fs.rename(`${file}.tmp`, file);
  }
  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  return {
    kind: "file",
    snapshot: () => serial(async () => {
      const db = await read();
      const groupBuys = Object.values(db.groupBuys).sort((a, b) => byNewest(a.data, b.data));
      const orders = Object.values(db.orders).sort((a, b) => byNewest(a.data, b.data) || b.data.orderNo.localeCompare(a.data.orderNo));
      return {
        state: { version: 1, groupBuys: groupBuys.map((row) => row.data), orders: orders.map((row) => row.data), stockLogs: Object.values(db.stockLogs).sort(byNewest), lookupLocks: db.lookupLocks, orderSeq: db.orderSeq },
        versions: { groupBuys: Object.fromEntries(groupBuys.map((row) => [row.data.id, row.version])), orders: Object.fromEntries(orders.map((row) => [row.data.id, row.version])) },
      };
    }),
    commit: (changes) => serial(async () => { const { db, versions } = applyChangesToDb(await read(), changes); await write(db); return versions; }),
    nextOrderSeq: () => serial(async () => { const db = await read(); db.orderSeq += 1; await write(db); return db.orderSeq; }),
    reserveOrderSeq: (minimum) => serial(async () => { const db = await read(); db.orderSeq = Math.max(db.orderSeq, minimum); await write(db); }),
    groupBuyById: async (id) => (await read()).groupBuys[id]?.data ?? null,
    groupBuyBySlug: async (slug) => Object.values((await read()).groupBuys).find((row) => row.data.slug === slug)?.data ?? null,
    groupBuysByIds: async (ids) => { const db = await read(); return ids.map((id) => db.groupBuys[id]?.data).filter((item): item is GroupBuy => Boolean(item)); },
    ordersByPhone: async (phone) => Object.values((await read()).orders).map((row) => row.data).filter((order) => order.phone === phone).sort(byNewest),
    orderByToken: async (token) => Object.values((await read()).orders).find((row) => row.data.lookupToken === token)?.data ?? null,
    lookupLock: async (phone) => (await read()).lookupLocks[phone] ?? null,
    // 개발용: 파일로 따로 두지 않고 data URL로 돌려준다.
    uploadImage: async (bytes, contentType) => `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

let cached: Backend | null = null;
export function backend(): Backend {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return (cached = supabaseBackend(url, key));
  if (process.env.NODE_ENV === "production") throw new ConfigError("공구 저장소가 아직 연결되지 않았어요. Vercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 넣어주세요.");
  return (cached = fileBackend(process.env.GB_DEV_FILE || path.join(process.cwd(), ".data", "group-buy-dev.json")));
}

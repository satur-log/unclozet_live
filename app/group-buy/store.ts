"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SubmitRequest } from "./model";
import type { ServerSubmitResult } from "./server/service";
import { applyVersions, diffState, hasChanges, withOrderedQty, withVersions, type Changes, type Versions } from "./sync";
import type { GroupBuyState } from "./types";

// 관리자 화면 저장소. 서버(/api/gb/admin/*)에서 전체 데이터를 받아 두고, 화면은 지금처럼 바로 바뀐 상태를 그린다.
// 바뀐 행만 골라 순서대로 서버에 보낸다. 저장이 실패하면(다른 곳에서 먼저 고친 경우 등) 최신 데이터로 다시 불러온다.

export type SyncStatus = "idle" | "loading" | "ready" | "locked" | "error";
export type SyncMeta = { status: SyncStatus; error: string; storage: "supabase" | "file" | null; saving: boolean };

let state: GroupBuyState | null = null;
let versions: Versions = { groupBuys: {}, orders: {} };
let meta: SyncMeta = { status: "idle", error: "", storage: null, saving: false };
const listeners = new Set<() => void>();
const errorListeners = new Set<(message: string) => void>();
let queue: Promise<void> = Promise.resolve();
let pending = 0;
/** 화면에서 바꿀 때마다 올라간다. 불러오는 사이에 바뀌었으면 받은 데이터를 버린다. */
let generation = 0;
/** 저장이 실패하면 올라간다. 실패 전에 줄 서 있던 저장은 보내지 않는다(실패한 상태 위에서 만든 변경이라). */
let epoch = 0;

function emit() { for (const listener of listeners) listener(); }
function setMeta(next: Partial<SyncMeta>) { meta = { ...meta, ...next }; emit(); }
function notifyError(message: string) { for (const listener of errorListeners) listener(message); }

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, cache: "no-store", headers: init.body && typeof init.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init.headers }); }
  catch { throw new ApiError("인터넷 연결을 확인해 주세요.", 0, "NETWORK"); }
  const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!response.ok) throw new ApiError(body?.error ?? `서버 오류 (${response.status})`, response.status, body?.code ?? "SERVER");
  return body as T;
}

type SnapshotResponse = { state: GroupBuyState; versions: Versions; storage: "supabase" | "file" };

/**
 * 서버에서 최신 데이터를 받는다. silent면 실패해도 화면을 바꾸지 않는다(주기적 새로고침).
 * 받는 사이에 화면에서 바꾼 게 있거나 저장 중이면 받은 데이터를 버린다(force면 그래도 덮어쓴다: 저장 실패 후 복구).
 */
export async function reloadGroupBuyState(silent = false, force = false) {
  if (!silent && !state) setMeta({ status: "loading", error: "" });
  try {
    const startedAt = generation;
    const snapshot = await api<SnapshotResponse>("/api/gb/admin/state");
    if (!force && (startedAt !== generation || pending > 0)) return;
    state = withOrderedQty(snapshot.state);
    versions = snapshot.versions;
    setMeta({ status: "ready", error: "", storage: snapshot.storage });
  } catch (error) {
    if (error instanceof ApiError && error.code === "LOCKED") { setMeta({ status: "locked", error: "" }); return; }
    if (silent && state) return;
    setMeta({ status: "error", error: error instanceof Error ? error.message : "불러오지 못했어요." });
  }
}

function send(changes: Changes) {
  const myEpoch = epoch;
  pending += 1;
  setMeta({ saving: true });
  queue = queue.then(async () => {
    if (myEpoch !== epoch) return;
    const body = withVersions(changes, versions);
    try {
      const result = await api<{ versions: Versions }>("/api/gb/admin/commit", { method: "POST", body: JSON.stringify({ changes: body }) });
      versions = applyVersions(versions, body, result.versions);
    } catch (error) {
      epoch += 1;
      notifyError(error instanceof Error ? error.message : "저장하지 못했어요.");
      await reloadGroupBuyState(false, true);
    }
  }).finally(() => { pending -= 1; if (!pending) setMeta({ saving: false }); });
}

/**
 * 상태 변경(model 함수)을 바로 화면에 반영하고 서버 저장을 줄 세운다. 검사 오류(GroupBuyError)는 그대로 던진다.
 * 반환값이 필요한 변경은 { state, value } 를 돌려준다.
 */
export function updateGroupBuyState<T = void>(change: (state: GroupBuyState) => GroupBuyState | { state: GroupBuyState; value: T }): T | undefined {
  if (!state) throw new Error("데이터를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.");
  const result = change(state);
  const next = "version" in result ? result : result.state;
  if (next !== state) {
    const changes = diffState(state, next, versions);
    state = next;
    generation += 1;
    emit();
    if (hasChanges(changes)) send(changes);
  }
  return "version" in result ? undefined : result.value;
}

/** 수기 주문은 주문번호를 서버가 매기므로 서버에서 만든 뒤 화면에 넣는다. */
export async function submitAdminOrder(request: SubmitRequest): Promise<ServerSubmitResult> {
  await queue;
  const result = await api<ServerSubmitResult>("/api/gb/admin/orders", { method: "POST", body: JSON.stringify(request) });
  if (result.ok && state) {
    state = withOrderedQty({ ...state, orders: [result.order, ...state.orders], stockLogs: [...result.stockLogs, ...state.stockLogs] });
    versions = { ...versions, orders: { ...versions.orders, ...result.versions.orders } };
    generation += 1;
    emit();
  }
  return result;
}

/** 예시 공구(마약 팬츠)를 주문 없이 넣는다. */
export async function insertExampleGroupBuy() {
  await queue;
  await api("/api/gb/admin/example", { method: "POST" });
  await reloadGroupBuyState(false, true);
}

export async function unlockAdmin(passcode: string) {
  await api("/api/gb/admin/session", { method: "POST", body: JSON.stringify({ passcode }) });
  await reloadGroupBuyState(false, true);
}

/** 상품 이미지를 서버(Supabase Storage)에 올리고 주소를 받는다. */
export async function uploadGroupBuyImage(blob: Blob) {
  const { url } = await api<{ url: string }>("/api/gb/admin/images", { method: "POST", body: blob, headers: { "Content-Type": blob.type || "image/jpeg" } });
  return url;
}

export function onGroupBuySyncError(listener: (message: string) => void) {
  errorListeners.add(listener);
  return () => { errorListeners.delete(listener); };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 화면이 붙는 순간 아직 안 불러왔으면 불러온다(코드가 다시 읽혀 저장소가 비었을 때도).
  if (meta.status === "idle") queueMicrotask(() => { if (meta.status === "idle") void reloadGroupBuyState(); });
  return () => { listeners.delete(listener); };
}

const POLL_MS = 20_000;
function watch() {
  // 다른 기기에서 들어온 고객 주문·관리자 변경을 주기적으로 받아온다. 저장 중일 때는 건너뛴다.
  const tick = () => { if (document.visibilityState === "visible" && pending === 0 && meta.status === "ready") void reloadGroupBuyState(true); };
  const timer = window.setInterval(tick, POLL_MS);
  window.addEventListener("focus", tick);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
}

export function useGroupBuyState(): GroupBuyState | null {
  useEffect(watch, []);
  return useSyncExternalStore(subscribe, () => state, () => null);
}

export function useGroupBuySync(): SyncMeta {
  return useSyncExternalStore(subscribe, () => meta, () => meta);
}

"use client";

import { useSyncExternalStore } from "react";
import { createSeedState } from "./mock";
import type { GroupBuyState } from "./types";

// Prototype storage: one JSON document in this browser's localStorage, shared
// by the admin screens and the customer screens on the same origin. Nothing is
// sent to Supabase. Other tabs pick up changes through the storage event.

export const GROUP_BUY_STORAGE_KEY = "unclozet-group-buy-prototype-v9";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: GroupBuyState | null = null;

function isState(value: unknown): value is GroupBuyState {
  const v = value as GroupBuyState | null;
  return Boolean(v && v.version === 1 && Array.isArray(v.groupBuys) && Array.isArray(v.orders) && Array.isArray(v.stockLogs) && typeof v.orderSeq === "number" && v.lookupLocks && typeof v.lookupLocks === "object");
}

/** 이전 버전에서 저장된 데이터에 새로 생긴 필드(상세페이지 등)를 채운다. */
function withDefaults(state: GroupBuyState): GroupBuyState {
  return {
    ...state,
    groupBuys: state.groupBuys.map((groupBuy) => ({
      ...groupBuy,
      policyText: groupBuy.policyText ?? "",
      notices: groupBuy.notices ?? "",
      checkoutNotice: groupBuy.checkoutNotice ?? "",
      completionNotice: groupBuy.completionNotice ?? "",
      remoteShippingFee: groupBuy.remoteShippingFee ?? null,
      products: groupBuy.products.map((product) => ({ ...product, summary: product.summary ?? "", originalPrice: product.originalPrice ?? null, images: product.images ?? [], detailBlocks: product.detailBlocks ?? [], axes: product.axes ?? [], sizeChart: product.sizeChart ?? null })),
    })),
  };
}

function read(): GroupBuyState {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(GROUP_BUY_STORAGE_KEY); } catch { /* storage blocked: fall through to seed */ }
  if (raw && raw === cachedRaw && cached) return cached;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isState(parsed)) { cachedRaw = raw; cached = withDefaults(parsed); return cached; }
    } catch { /* corrupted: reseed below */ }
  }
  const seeded = createSeedState();
  try { write(seeded); } catch { cachedRaw = null; cached = seeded; }
  return seeded;
}

function write(next: GroupBuyState) {
  const raw = JSON.stringify(next);
  try { window.localStorage.setItem(GROUP_BUY_STORAGE_KEY, raw); }
  catch { throw new Error("브라우저 저장 공간이 부족합니다. 업로드한 이미지 수를 줄이거나 이미지 URL을 사용하세요."); }
  cachedRaw = raw;
  cached = next;
}

function emit() { for (const listener of listeners) listener(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === GROUP_BUY_STORAGE_KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function getGroupBuyState() { return read(); }

/** Runs a state transition against the latest stored state (like a DB transaction) and persists it. */
export function updateGroupBuyState<T = void>(change: (state: GroupBuyState) => GroupBuyState | { state: GroupBuyState; value: T }): T | undefined {
  const result = change(read());
  const next = "version" in result ? result : result.state;
  if (next !== cached) { write(next); emit(); }
  return "version" in result ? undefined : result.value;
}

export function resetGroupBuyState() { write(createSeedState()); emit(); }

export function useGroupBuyState(): GroupBuyState | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import type { SubmitRequest, SubmitResult } from "./model";
import { api, ApiError } from "./store";
import type { GbOrder, GroupBuyState } from "./types";

// 고객 화면 데이터. 고객은 자기에게 필요한 공구·주문만 서버(/api/gb/*)에서 받는다.
// 상세 → 주문서처럼 같은 공구 안에서 넘어갈 때 다시 "불러오는 중"이 뜨지 않게 받은 공구는 기억해 둔다.

const groupBuyCache = new Map<string, GroupBuyState>();

// 서버가 HTML을 만들 때 넣어 준 공구 정보. 화면이 데이터를 기다리지 않고 바로 그려진다.
const SeedContext = createContext<{ slug: string; state: GroupBuyState | null } | null>(null);

export function PublicGroupBuySeed({ slug, state, children }: { slug: string; state: GroupBuyState | null; children: ReactNode }) {
  return createElement(SeedContext.Provider, { value: { slug, state } }, children);
}

function useRemote(key: string, cache: Map<string, GroupBuyState> | null, load: () => Promise<GroupBuyState>, seed: GroupBuyState | null = null) {
  const [state, setState] = useState<GroupBuyState | null>(() => cache?.get(key) ?? seed);
  useEffect(() => {
    let alive = true;
    const refresh = () => load().then((next) => { cache?.set(key, next); if (alive) setState(next); }).catch(() => { if (alive) setState((current) => current ?? { version: 1, groupBuys: [], orders: [], stockLogs: [], orderSeq: 0, lookupLocks: {} }); });
    void refresh();
    // 판매자가 품절·송장 등을 바꾸면 다시 들어왔을 때 반영되도록
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
    // load는 key로만 달라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** 공구 상세·주문서용. 받기 전에는 null, 없는 공구면 groupBuys가 빈 상태. */
export function usePublicGroupBuy(slug: string) {
  const seed = useContext(SeedContext);
  return useRemote(slug, groupBuyCache, () => api<GroupBuyState>(`/api/gb/public/${encodeURIComponent(slug)}`), seed?.slug === slug ? seed.state : null);
}

/** 주문 전용 링크 */
export function useOrderByToken(token: string) {
  return useRemote(`order:${token}`, null, () => api<GroupBuyState>(`/api/gb/order/${encodeURIComponent(token)}`));
}

export type PublicSubmitResult = { ok: true; order: GbOrder } | Exclude<SubmitResult, { ok: true }> | { ok: false; code: "NETWORK"; message: string };

export async function submitPublicOrder(request: SubmitRequest): Promise<PublicSubmitResult> {
  try { return await api<PublicSubmitResult>("/api/gb/orders", { method: "POST", body: JSON.stringify(request) }); }
  catch (error) { return { ok: false, code: "NETWORK", message: error instanceof ApiError ? error.message : "주문을 보내지 못했어요. 잠시 후 다시 시도해 주세요." }; }
}

export type PublicLookupResult = { ok: true; state: GroupBuyState } | { ok: false; message: string; lockedUntil: string | null };

export async function lookupPublicOrders(phone: string, pin: string): Promise<PublicLookupResult> {
  try { return await api<PublicLookupResult>("/api/gb/lookup", { method: "POST", body: JSON.stringify({ phone, pin }) }); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "조회하지 못했어요.", lockedUntil: null }; }
}

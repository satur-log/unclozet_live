"use client";

import { useSyncExternalStore } from "react";

// 장바구니 없이 "상품 상세에서 고른 옵션 → 주문서"로 넘기는 한 번짜리 선택.
// 탭 단위(sessionStorage)라 주문서에서 새로고침해도 유지되고, 주문이 끝나면 비운다.

export type Cart = Record<string, number>;
export type Selection = { productId: string; lines: Cart };
const key = (slug: string) => `unclozet-gb-selection:${slug}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Selection | null }>();

function read(slug: string): Selection | null {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(key(slug)); } catch { /* blocked */ }
  const hit = cache.get(slug);
  if (hit && hit.raw === raw) return hit.value;
  let value: Selection | null = null;
  try { const parsed = raw ? JSON.parse(raw) : null; if (parsed && typeof parsed.productId === "string" && parsed.lines && typeof parsed.lines === "object") value = parsed; } catch { /* ignore */ }
  cache.set(slug, { raw, value });
  return value;
}

export function saveSelection(slug: string, selection: Selection | null) {
  try {
    if (selection) window.sessionStorage.setItem(key(slug), JSON.stringify({ ...selection, lines: Object.fromEntries(Object.entries(selection.lines).filter(([, quantity]) => quantity > 0)) }));
    else window.sessionStorage.removeItem(key(slug));
  } catch { /* storage unavailable */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function useSelection(slug: string) {
  return useSyncExternalStore(subscribe, () => read(slug), () => null);
}

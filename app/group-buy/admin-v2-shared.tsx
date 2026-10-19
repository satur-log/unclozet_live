"use client";

import { createContext, useCallback, useContext } from "react";
import { updateGroupBuyState } from "./store";
import type { deleteGroupBuy } from "./model";
import type { GroupBuyState } from "./types";
import { copyText } from "./ui";

// 공구 관리 v2 공통: 토스트(되돌리기 포함)와 상태 변경 실행.

export type Toast = { id: number; message: string; error?: boolean; undo?: () => void };
export const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => undefined);

/** 상태 변경을 실행하고 토스트로 알린다. undo를 주면 토스트에 되돌리기 버튼이 붙는다. 실패하면 false. */
export function useRun() {
  const toast = useContext(ToastContext);
  return useCallback((change: (state: GroupBuyState) => GroupBuyState, message?: string, undo?: (state: GroupBuyState) => GroupBuyState) => {
    try {
      updateGroupBuyState(change);
      if (message) toast({ message, undo: undo ? () => { try { updateGroupBuyState(undo); toast({ message: "되돌렸어요." }); } catch (error) { toast({ message: error instanceof Error ? error.message : "되돌리지 못했어요.", error: true }); } } : undefined });
      return true;
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : "처리하지 못했어요.", error: true });
      return false;
    }
  }, [toast]);
}

export function useCopy() {
  const toast = useContext(ToastContext);
  return (text: string, label: string) => void copyText(text).then((ok) => toast(ok ? { message: `${label}를 복사했어요.` } : { message: "클립보드에 접근하지 못했어요.", error: true }));
}

// 삭제한 공구를 목록 화면 토스트의 되돌리기로 넘겨주는 한 번짜리 보관함.
const DELETED_KEY = "gbx-deleted-group-buy";
export type DeletedGroupBuy = ReturnType<typeof deleteGroupBuy>["removed"];
export function stashDeletedGroupBuy(removed: DeletedGroupBuy) { try { sessionStorage.setItem(DELETED_KEY, JSON.stringify(removed)); } catch { /* 되돌리기만 못 할 뿐 삭제는 그대로 */ } }
export function takeDeletedGroupBuy(): DeletedGroupBuy | null {
  try { const raw = sessionStorage.getItem(DELETED_KEY); sessionStorage.removeItem(DELETED_KEY); return raw ? JSON.parse(raw) as DeletedGroupBuy : null; } catch { return null; }
}

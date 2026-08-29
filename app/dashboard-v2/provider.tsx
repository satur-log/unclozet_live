"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createMockState } from "./mock-data";
import { loadMockState, saveMockState } from "./repository";
import type { DashboardState } from "./types";

type Context = {
  state: DashboardState;
  commit: (change: (state: DashboardState) => DashboardState, message?: string) => boolean;
  notify: (message: string, error?: boolean) => void;
  reset: () => void;
};
const DashboardContext = createContext<Context | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DashboardState | null>(null);
  const stateRef = useRef<DashboardState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function notify(message: string, error = false) {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ message, error });
    timer.current = setTimeout(() => setNotice(null), error ? 9000 : 4500);
  }

  useEffect(() => {
    try {
      const loaded = loadMockState(window.localStorage);
      stateRef.current = loaded;
      setState(loaded);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "브라우저 저장소를 읽을 수 없습니다."); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const commit: Context["commit"] = (change, message) => {
    try {
      if (!stateRef.current) throw new Error("데이터를 불러오는 중입니다.");
      const next = change(stateRef.current);
      saveMockState(window.localStorage, next);
      stateRef.current = next;
      setState(next);
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.", true);
      return false;
    }
  };

  function reset() {
    try {
      const next = createMockState();
      saveMockState(window.localStorage, next);
      stateRef.current = next;
      setState(next);
      setLoadError("");
      notify("가상 데이터가 초기화되었습니다.");
    } catch { notify("브라우저 저장소에 접근할 수 없습니다.", true); }
  }

  return <>
    {loadError ? <main className="v2-recovery"><h1>데모 데이터를 불러오지 못했어요</h1><p>{loadError}</p><button onClick={reset}>V2 데모 초기화</button><small>V1 저장 데이터는 변경하지 않습니다.</small></main>
      : state ? <DashboardContext.Provider value={{ state, commit, notify, reset }}>{children}</DashboardContext.Provider>
      : <div className="v2-loading" role="status">데모 작업 공간을 준비하고 있어요…</div>}
    {notice ? <div role={notice.error ? "alert" : "status"} className={`v2-toast ${notice.error ? "error" : ""}`}><span>{notice.error ? "!" : "✓"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div> : null}
  </>;
}

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("DashboardProvider가 필요합니다.");
  return value;
}

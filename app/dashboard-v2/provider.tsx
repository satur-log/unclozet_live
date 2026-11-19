"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createMockState } from "./mock-data";
import {
  clearRemoteSavePending,
  fetchRemoteDashboardState,
  RemoteDashboardError,
  remoteSavePending,
  saveRemoteDashboardState,
} from "./remote-repository";
import { hasMeaningfulDashboardChange, isDashboardState, DashboardStorageError, dashboardStorageFailure, LOCAL_TEST_STORAGE_KEY, STORAGE_KEY, saveMockState } from "./repository";
import type { DashboardState } from "./types";

// 데이터 원본
// - shared(운영): Supabase 하나뿐. 브라우저는 /api/dashboard/state로만 읽고 쓰며, 브라우저 복사본을 만들거나 올리지 않는다.
//   저장은 "마지막으로 본 버전" 기준이라, 다른 기기가 먼저 저장했으면 최신 데이터 위에 내 변경을 다시 적용해 저장한다.
// - local-test(/test) · Supabase 미설정 개발 환경: 이 브라우저의 localStorage만 쓴다.

export type SyncStatus = "loading" | "saving" | "synced" | "error" | "local";
type Change = (state: DashboardState) => DashboardState;

type Context = {
  state: DashboardState;
  syncStatus: SyncStatus;
  localOnly: boolean;
  commit: (change: Change, message?: string) => boolean;
  notify: (message: string, error?: boolean) => void;
};
const DashboardContext = createContext<Context | null>(null);

const SAVE_DELAY_MS = 700;
const MAX_CONFLICT_RETRIES = 3;

function storageMessage(error: unknown) {
  if (error instanceof DashboardStorageError && error.kind === "quota") {
    const size = error.payloadBytes == null ? "" : ` 저장하려던 데이터는 약 ${Math.ceil(error.payloadBytes / 1024)}KB입니다.`;
    return `브라우저 저장 공간이 부족해 저장하지 못했습니다.${size}`;
  }
  return "브라우저 저장 공간에 접근할 수 없어 저장하지 못했습니다.";
}

function readStoredState(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { state: null, error: null as unknown };
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return { state: null, error: new Error("브라우저에 저장된 데이터 형식이 올바르지 않습니다.") }; }
    if (!isDashboardState(value)) return { state: null, error: new Error("브라우저에 저장된 데이터 형식이 올바르지 않습니다.") };
    return { state: value, error: null as unknown };
  } catch (error) {
    return { state: null, error: dashboardStorageFailure(error, "read", key) };
  }
}

/** 예전 버전이 Supabase에 보내지 못하고 남긴 브라우저 복사본. 자동으로 올리지 않고 사용자에게 보여주기만 한다. */
function readUnsentLegacyCopy(remote: DashboardState) {
  try {
    if (!remoteSavePending(window.localStorage)) return null;
  } catch { return null; }
  const { state } = readStoredState(STORAGE_KEY);
  return state && hasMeaningfulDashboardChange(remote, state) ? state : null;
}

function downloadJson(state: DashboardState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `unclozet-unsent-browser-copy-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function goToLogin() {
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
}

export function DashboardProvider({ children, mode = "shared" }: { children: React.ReactNode; mode?: "shared" | "local-test" }) {
  const testMode = mode === "local-test";
  const [state, setState] = useState<DashboardState | null>(null);
  const [backend, setBackend] = useState<"remote" | "local" | null>(testMode ? "local" : null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [unsentCopy, setUnsentCopy] = useState<DashboardState | null>(null);

  const stateRef = useRef<DashboardState | null>(null);
  const backendRef = useRef<"remote" | "local" | null>(null);
  const baseUpdatedAt = useRef("");
  const unsaved = useRef<Change[]>([]);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const readyRef = useRef(false);
  const localKey = testMode ? LOCAL_TEST_STORAGE_KEY : STORAGE_KEY;

  function notify(message: string, error = false) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, error });
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 9000 : 4500);
  }

  function show(next: DashboardState) {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }

  async function flush() {
    if (saving.current || backendRef.current !== "remote") return;
    saving.current = true;
    let conflicts = 0;
    try {
      while (unsaved.current.length && mounted.current) {
        const count = unsaved.current.length;
        const snapshot = stateRef.current!;
        setSyncStatus("saving");
        try {
          const { updatedAt } = await saveRemoteDashboardState(snapshot, baseUpdatedAt.current);
          baseUpdatedAt.current = updatedAt;
          unsaved.current.splice(0, count);
        } catch (error) {
          if (error instanceof RemoteDashboardError && error.code === "LOCKED") { goToLogin(); return; }
          if (!(error instanceof RemoteDashboardError && error.code === "CONFLICT")) throw error;
          if (++conflicts > MAX_CONFLICT_RETRIES) throw new Error("다른 곳에서 계속 저장하고 있어 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
          // 다른 기기·탭이 먼저 저장했다. 최신 데이터를 받아 그 위에 아직 저장하지 못한 내 변경을 순서대로 다시 적용한다.
          const latest = await fetchRemoteDashboardState();
          if (latest.mode !== "remote") throw new Error("Supabase 설정을 확인할 수 없어 저장을 멈췄어요.");
          baseUpdatedAt.current = latest.updatedAt;
          let rebased = latest.state;
          try { for (const change of unsaved.current) rebased = change(rebased); }
          catch {
            unsaved.current = [];
            show(latest.state);
            throw new Error("다른 곳에서 먼저 바뀐 내용과 겹쳐 방금 변경을 적용하지 못했어요. 최신 내용을 확인한 뒤 다시 해주세요.");
          }
          show(rebased);
          if (!hasMeaningfulDashboardChange(latest.state, rebased)) unsaved.current = [];
          notify("다른 곳에서 바뀐 내용을 불러와 그 위에 저장했어요.");
        }
      }
      if (mounted.current) setSyncStatus("synced");
    } catch (error) {
      if (!mounted.current) return;
      setSyncStatus("error");
      notify(`${error instanceof Error ? error.message : "Supabase 저장에 실패했어요."} 저장되지 않은 변경은 이 화면에만 있어요. 창을 닫지 마세요. 10초 뒤 다시 저장해 볼게요.`, true);
      if (unsaved.current.length && !saveTimer.current) saveTimer.current = setTimeout(() => { saveTimer.current = null; void flush(); }, 10_000);
    } finally {
      saving.current = false;
    }
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void flush(); }, SAVE_DELAY_MS);
  }

  useEffect(() => {
    mounted.current = true;
    readyRef.current = false;
    let cancelled = false;

    function loadLocal() {
      const local = readStoredState(localKey);
      if (local.error) { setLoadError(storageMessage(local.error)); setSyncStatus("error"); return; }
      backendRef.current = "local";
      setBackend("local");
      show(local.state ?? createMockState());
      readyRef.current = true;
      setSyncStatus("local");
    }

    async function initialize() {
      setLoadError("");
      if (testMode) { loadLocal(); return; }
      let remote;
      try { remote = await fetchRemoteDashboardState(); }
      catch (error) {
        if (cancelled) return;
        if (error instanceof RemoteDashboardError && error.code === "LOCKED") { goToLogin(); return; }
        setLoadError(error instanceof Error ? error.message : "Supabase 공유 데이터를 불러오지 못했습니다.");
        setSyncStatus("error");
        return;
      }
      if (cancelled) return;
      if (remote.mode === "local") { loadLocal(); return; }
      backendRef.current = "remote";
      setBackend("remote");
      baseUpdatedAt.current = remote.updatedAt;
      unsaved.current = [];
      show(remote.state);
      setUnsentCopy(readUnsentLegacyCopy(remote.state));
      readyRef.current = true;
      setSyncStatus("synced");
    }

    void initialize();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    };
  }, [testMode, retryCount, localKey]);

  // 저장 전이거나 저장 중이면 창 닫기·새로고침 전에 묻는다.
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (backendRef.current === "remote" && (unsaved.current.length || saving.current)) { event.preventDefault(); event.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const commit: Context["commit"] = (change, message) => {
    try {
      if (!stateRef.current || !readyRef.current) throw new Error("최신 데이터를 확인하는 중입니다. 잠시 후 다시 시도하세요.");
      const previous = stateRef.current;
      const next = change(previous);
      if (!hasMeaningfulDashboardChange(previous, next)) return true;
      if (backendRef.current === "remote") {
        unsaved.current.push(change);
        show(next);
        scheduleSave();
      } else {
        try { saveMockState(window.localStorage, next, localKey); }
        catch (error) { throw new Error(storageMessage(error)); }
        show(next);
      }
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "저장하지 못했습니다.", true);
      return false;
    }
  };

  function dismissUnsentCopy() {
    try { clearRemoteSavePending(window.localStorage); } catch { /* 표시만 숨긴다 */ }
    setUnsentCopy(null);
  }

  return <>
    {loadError ? <main className="v2-recovery"><h1>V2 데이터를 불러오지 못했어요</h1><p>{loadError}</p><button onClick={() => { setLoadError(""); setSyncStatus("loading"); setRetryCount((count) => count + 1); }}>다시 불러오기</button><small>Supabase 데이터는 변경하지 않았습니다.</small></main>
      : state && backend ? <DashboardContext.Provider value={{ state, syncStatus, localOnly: backend === "local", commit, notify }}>{children}</DashboardContext.Provider>
      : <div className="v2-loading" role="status">공유 작업 공간을 불러오고 있어요…</div>}
    {unsentCopy && !loadError ? <div role="status" className="v2-refresh-notice" style={{ top: "auto", bottom: 18, display: "grid", gap: "var(--uc-space-8)", maxWidth: "min(520px, calc(100vw - 32px))" }}>
      <span>이 브라우저에 예전에 Supabase로 보내지 못한 복사본이 남아 있어요. 자동으로 반영하지 않았고, 지금 화면은 Supabase 최신 데이터입니다.</span>
      <span style={{ display: "flex", gap: "var(--uc-space-8)", justifyContent: "center" }}>
        <button type="button" onClick={() => downloadJson(unsentCopy)}>복사본 파일로 받기</button>
        <button type="button" onClick={dismissUnsentCopy}>확인했어요</button>
      </span>
    </div> : null}
    {notice ? <div role={notice.error ? "alert" : "status"} className={`v2-toast ${notice.error ? "error" : ""}`}><span>{notice.error ? "!" : "✓"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div> : null}
  </>;
}

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("DashboardProvider가 필요합니다.");
  return value;
}

"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createMockState } from "./mock-data";
import { fetchLegacyData, legacyImportCompleted, markLegacyImportCompleted, mergeLegacyData } from "./legacy-import";
import {
  clearRemoteSavePending,
  fetchRemoteDashboardState,
  hasRemoteDashboardConfig,
  markRemoteMigrationCompleted,
  markRemoteSavePending,
  mergeDashboardStates,
  remoteMigrationCompleted,
  remoteSavePending,
  saveRemoteDashboardState,
} from "./remote-repository";
import { hasMeaningfulDashboardChange, LOCAL_TEST_STORAGE_KEY, STORAGE_KEY, loadMockState, saveMockState } from "./repository";
import type { DashboardState } from "./types";

export type SyncStatus = "loading" | "saving" | "synced" | "error" | "local";

type Context = {
  state: DashboardState;
  syncStatus: SyncStatus;
  localOnly: boolean;
  commit: (change: (state: DashboardState) => DashboardState, message?: string) => boolean;
  notify: (message: string, error?: boolean) => void;
  reset: () => void;
};
const DashboardContext = createContext<Context | null>(null);

const SAVE_DELAY_MS = 700;

export function DashboardProvider({ children, mode = "shared" }: { children: React.ReactNode; mode?: "shared" | "local-test" }) {
  const localOnly = mode === "local-test";
  const storageKey = localOnly ? LOCAL_TEST_STORAGE_KEY : undefined;
  const [state, setState] = useState<DashboardState | null>(null);
  const stateRef = useRef<DashboardState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const saveGeneration = useRef(0);
  const mounted = useRef(true);
  const readyRef = useRef(false);

  function notify(message: string, error = false) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, error });
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 9000 : 4500);
  }

  function queueRemoteSave(next: DashboardState) {
    if (localOnly || !hasRemoteDashboardConfig()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const generation = ++saveGeneration.current;
    setSyncStatus("saving");
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(() => saveRemoteDashboardState(next))
        .then(() => {
          if (generation === saveGeneration.current) {
            clearRemoteSavePending(window.localStorage);
            if (mounted.current) setSyncStatus("synced");
          }
        })
        .catch((error) => {
          if (!mounted.current) return;
          setSyncStatus("error");
          notify(error instanceof Error ? error.message : "Supabase 동기화에 실패했습니다.", true);
        });
    }, SAVE_DELAY_MS);
  }

  useEffect(() => {
    mounted.current = true;
    readyRef.current = false;
    let cancelled = false;

    async function initialize() {
      try {
        let local = loadMockState(window.localStorage, storageKey);
        if (localOnly) {
          if (cancelled) return;
          stateRef.current = local;
          setState(local);
          readyRef.current = true;
          setSyncStatus("local");
          return;
        }
        const remoteEnabled = hasRemoteDashboardConfig();

        if (remoteEnabled && window.localStorage.getItem(storageKey ?? STORAGE_KEY)) {
          // A returning browser can show its last saved view immediately.
          // Interactions stay locked until the shared state has been checked.
          stateRef.current = local;
          setState(local);
        }

        if (!remoteEnabled) {
          if (!legacyImportCompleted(window.localStorage)) {
            const { memos, rounds } = await fetchLegacyData();
            const result = mergeLegacyData(local, memos, rounds);
            local = result.state;
            saveMockState(window.localStorage, local, storageKey);
            markLegacyImportCompleted(window.localStorage);
          }
          if (cancelled) return;
          stateRef.current = local;
          setState(local);
          readyRef.current = true;
          setSyncStatus("local");
          return;
        }

        const remote = await fetchRemoteDashboardState();
        if (cancelled) return;
        let next = remote ?? local;
        let shouldSaveRemote = !remote;

        if (remote && !remoteMigrationCompleted(window.localStorage)) {
          next = mergeDashboardStates(remote, local);
          shouldSaveRemote = true;
        } else if (remote && remoteSavePending(window.localStorage)) {
          next = local;
          shouldSaveRemote = true;
        }

        if (!legacyImportCompleted(window.localStorage)) {
          const { memos, rounds } = await fetchLegacyData();
          if (cancelled) return;
          const result = mergeLegacyData(next, memos, rounds);
          next = result.state;
          markLegacyImportCompleted(window.localStorage);
          shouldSaveRemote = shouldSaveRemote || result.importedBroadcasts > 0;
        }

        if (shouldSaveRemote) {
          if (cancelled) return;
          await saveRemoteDashboardState(next);
          clearRemoteSavePending(window.localStorage);
        }
        if (cancelled) return;
        saveMockState(window.localStorage, next, storageKey);
        markRemoteMigrationCompleted(window.localStorage);
        stateRef.current = next;
        setState(next);
        readyRef.current = true;
        setSyncStatus("synced");
      } catch (error) {
        if (cancelled) return;
        try {
          const fallback = loadMockState(window.localStorage, storageKey);
          stateRef.current = fallback;
          setState(fallback);
          readyRef.current = true;
          setSyncStatus("error");
          notify(error instanceof Error ? error.message : "공유 데이터를 불러오지 못했습니다.", true);
        } catch (fallbackError) {
          setLoadError(fallbackError instanceof Error ? fallbackError.message : "브라우저 저장소를 읽을 수 없습니다.");
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [localOnly, storageKey]);

  const commit: Context["commit"] = (change, message) => {
    try {
      if (!stateRef.current || !readyRef.current) throw new Error("최신 데이터를 확인하는 중입니다. 잠시 후 다시 시도하세요.");
      const previous = stateRef.current;
      const next = change(previous);
      if (!hasMeaningfulDashboardChange(previous, next)) return true;
      saveMockState(window.localStorage, next, storageKey);
      if (!localOnly && hasRemoteDashboardConfig()) markRemoteSavePending(window.localStorage);
      stateRef.current = next;
      setState(next);
      queueRemoteSave(next);
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
      saveMockState(window.localStorage, next, storageKey);
      stateRef.current = next;
      setState(next);
      setLoadError("");
      queueRemoteSave(next);
      notify("V2 데이터가 초기화되었습니다.");
    } catch { notify("브라우저 저장소에 접근할 수 없습니다.", true); }
  }

  return <>
    {loadError ? <main className="v2-recovery"><h1>V2 데이터를 불러오지 못했어요</h1><p>{loadError}</p><button onClick={reset}>V2 데이터 초기화</button><small>V1 저장 데이터는 변경하지 않습니다.</small></main>
      : state ? <DashboardContext.Provider value={{ state, syncStatus, localOnly, commit, notify, reset }}><div inert={syncStatus === "loading"}>{children}</div>{syncStatus === "loading" ? <div className="v2-refresh-notice" role="status">최신 데이터를 확인하는 중…</div> : null}</DashboardContext.Provider>
      : <div className="v2-loading" role="status">공유 작업 공간을 불러오고 있어요…</div>}
    {notice ? <div role={notice.error ? "alert" : "status"} className={`v2-toast ${notice.error ? "error" : ""}`}><span>{notice.error ? "!" : "✓"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div> : null}
  </>;
}

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("DashboardProvider가 필요합니다.");
  return value;
}

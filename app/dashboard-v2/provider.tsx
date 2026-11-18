"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createMockState } from "./mock-data";
import { fetchLegacyData, legacyImportCompleted, markLegacyImportCompleted, mergeLegacyData } from "./legacy-import";
import {
  clearRemoteSavePending,
  fetchRemoteDashboardState,
  hasRemoteDashboardConfig,
  REMOTE_MIGRATION_KEY,
  REMOTE_PENDING_KEY,
  markRemoteMigrationCompleted,
  markRemoteSavePending,
  mergeDashboardStates,
  remoteMigrationCompleted,
  remoteSavePending,
  saveRemoteDashboardState,
} from "./remote-repository";
import { hasMeaningfulDashboardChange, isDashboardState, DashboardStorageError, dashboardStorageFailure, LOCAL_TEST_STORAGE_KEY, STORAGE_KEY, saveMockState } from "./repository";
import type { DashboardState } from "./types";

export type SyncStatus = "loading" | "saving" | "synced" | "error" | "local";

type Context = {
  state: DashboardState;
  syncStatus: SyncStatus;
  localOnly: boolean;
  commit: (change: (state: DashboardState) => DashboardState, message?: string) => boolean;
  notify: (message: string, error?: boolean) => void;
};
const DashboardContext = createContext<Context | null>(null);

const SAVE_DELAY_MS = 700;

function storageMessage(error: unknown) {
  if (error instanceof DashboardStorageError && error.kind === "quota") {
    const size = error.payloadBytes == null ? "" : ` 저장하려던 데이터는 약 ${Math.ceil(error.payloadBytes / 1024)}KB입니다.`;
    return `브라우저 저장 공간이 부족해 오프라인 복사본을 저장하지 못했습니다.${size} Supabase 데이터는 계속 사용합니다.`;
  }
  return "브라우저 저장 공간에 접근할 수 없어 오프라인 복사본을 갱신하지 못했습니다. Supabase 데이터는 계속 사용합니다.";
}

function readStoredState(storage: Storage, key: string) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { state: null, exists: false, error: null as unknown };
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return { state: null, exists: true, error: new Error("브라우저에 저장된 데이터 형식이 올바르지 않습니다.") }; }
    if (!isDashboardState(value)) return { state: null, exists: true, error: new Error("브라우저에 저장된 데이터 형식이 올바르지 않습니다.") };
    return { state: value, exists: true, error: null as unknown };
  } catch (error) {
    return { state: null, exists: false, error: dashboardStorageFailure(error, "read", key) };
  }
}

function readFlag(read: () => boolean, storageKey: string, onError: (error: unknown) => void) {
  try { return read(); }
  catch (error) { onError(dashboardStorageFailure(error, "read", storageKey)); return false; }
}

function writeFlag(write: () => void, storageKey: string, onError: (error: unknown) => void) {
  try { write(); }
  catch (error) { onError(dashboardStorageFailure(error, "write", storageKey)); }
}

export function DashboardProvider({ children, mode = "shared" }: { children: React.ReactNode; mode?: "shared" | "local-test" }) {
  const localOnly = mode === "local-test";
  const storageKey = localOnly ? LOCAL_TEST_STORAGE_KEY : undefined;
  const [state, setState] = useState<DashboardState | null>(null);
  const stateRef = useRef<DashboardState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
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
            writeFlag(() => clearRemoteSavePending(window.localStorage), REMOTE_PENDING_KEY, (error) => notify(storageMessage(error), false));
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
      setLoadError("");
      const localResult = localOnly
        ? readStoredState(window.localStorage, storageKey!)
        : readStoredState(window.localStorage, STORAGE_KEY);
      if (localOnly) {
        if (localResult.error) {
          setLoadError(storageMessage(localResult.error));
          setSyncStatus("error");
          return;
        }
        const local = localResult.state ?? createMockState();
        if (cancelled) return;
        stateRef.current = local;
        setState(local);
        readyRef.current = true;
        setSyncStatus("local");
        return;
      }

      const remoteEnabled = hasRemoteDashboardConfig();
      if (!remoteEnabled) {
        if (localResult.error) {
          setLoadError(storageMessage(localResult.error));
          setSyncStatus("error");
          return;
        }
        const local = localResult.state ?? createMockState();
        if (cancelled) return;
        stateRef.current = local;
        setState(local);
        readyRef.current = true;
        setSyncStatus("local");
        return;
      }

      let remote: DashboardState | null;
      try {
        remote = await fetchRemoteDashboardState();
      } catch (error) {
        if (cancelled) return;
        if (localResult.state) {
          stateRef.current = localResult.state;
          setState(localResult.state);
        }
        readyRef.current = false;
        setLoadError(error instanceof Error ? error.message : "Supabase 공유 데이터를 불러오지 못했습니다.");
        setSyncStatus("error");
        return;
      }
      if (cancelled) return;

      // A successful empty response is different from a failed query. Never upload
      // an empty/mock or stale browser cache just because the workspace row is absent.
      if (!remote) {
        if (localResult.state) {
          stateRef.current = localResult.state;
          setState(localResult.state);
        }
        readyRef.current = false;
        setLoadError("Supabase 공유 작업공간을 찾지 못했습니다. 브라우저 복사본은 보존했으며 저장하지 않았습니다.");
        setSyncStatus("error");
        return;
      }

      let next = remote;
      let shouldSaveRemote = false;
      let storageFlagsReadable = true;
      const onFlagError = (error: unknown) => { storageFlagsReadable = false; notify(storageMessage(error), false); };
      const migrationRead = readFlag(() => remoteMigrationCompleted(window.localStorage), REMOTE_MIGRATION_KEY, onFlagError);
      const pendingRead = readFlag(() => remoteSavePending(window.localStorage), REMOTE_PENDING_KEY, onFlagError);
      if (localResult.error) notify(storageMessage(localResult.error), false);

      if (storageFlagsReadable && !migrationRead && localResult.state) {
        next = mergeDashboardStates(remote, localResult.state);
        shouldSaveRemote = true;
      } else if (storageFlagsReadable && pendingRead && localResult.state) {
        next = localResult.state;
        shouldSaveRemote = true;
      }

      const legacyRead = readFlag(() => legacyImportCompleted(window.localStorage), "unclozet-dashboard-v2-legacy-import-v1", onFlagError);
      if (storageFlagsReadable && !legacyRead) {
        try {
          const { memos, rounds } = await fetchLegacyData();
          if (cancelled) return;
          const result = mergeLegacyData(next, memos, rounds);
          next = result.state;
          shouldSaveRemote = shouldSaveRemote || result.importedBroadcasts > 0;
          writeFlag(() => markLegacyImportCompleted(window.localStorage), "unclozet-dashboard-v2-legacy-import-v1", (error) => notify(storageMessage(error), false));
        } catch (error) {
          // The V2 Supabase read succeeded, so a failed optional legacy read must not
          // replace it with a local/mock state or block it from being displayed.
          notify(error instanceof Error ? `기존 데이터 추가 조회를 건너뛰었습니다: ${error.message}` : "기존 데이터 추가 조회를 건너뛰었습니다.", false);
        }
      }

      if (shouldSaveRemote) {
        try {
          await saveRemoteDashboardState(next);
          writeFlag(() => clearRemoteSavePending(window.localStorage), REMOTE_PENDING_KEY, (error) => notify(storageMessage(error), false));
        } catch (error) {
          if (cancelled) return;
          setLoadError(error instanceof Error ? error.message : "Supabase에 기존 변경 내용을 동기화하지 못했습니다.");
          setSyncStatus("error");
          stateRef.current = next;
          setState(next);
          return;
        }
      }
      if (cancelled) return;
      try { saveMockState(window.localStorage, next, STORAGE_KEY); }
      catch (error) { notify(storageMessage(error), false); }
      writeFlag(() => markRemoteMigrationCompleted(window.localStorage), REMOTE_MIGRATION_KEY, (error) => notify(storageMessage(error), false));
      stateRef.current = next;
      setState(next);
      readyRef.current = true;
      setSyncStatus("synced");
      if (localResult.error) notify(storageMessage(localResult.error), false);
    }

    void initialize();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [localOnly, retryCount, storageKey]);

  const commit: Context["commit"] = (change, message) => {
    try {
      if (!stateRef.current || !readyRef.current) throw new Error("최신 데이터를 확인하는 중입니다. 잠시 후 다시 시도하세요.");
      const previous = stateRef.current;
      const next = change(previous);
      if (!hasMeaningfulDashboardChange(previous, next)) return true;
      const remoteEnabled = !localOnly && hasRemoteDashboardConfig();
      let cacheSaved = true;
      try { saveMockState(window.localStorage, next, storageKey); }
      catch (error) {
        cacheSaved = false;
        if (!remoteEnabled) throw error;
        notify(storageMessage(error), false);
      }
      if (remoteEnabled && cacheSaved) writeFlag(() => markRemoteSavePending(window.localStorage), REMOTE_PENDING_KEY, (error) => notify(storageMessage(error), false));
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

  return <>
    {loadError ? <main className="v2-recovery"><h1>V2 데이터를 불러오지 못했어요</h1><p>{loadError}</p><button onClick={() => { setLoadError(""); setRetryCount((count) => count + 1); }}>다시 불러오기</button><small>저장된 Supabase 데이터와 브라우저 복사본은 변경하지 않았습니다.</small></main>
      : state ? <DashboardContext.Provider value={{ state, syncStatus, localOnly, commit, notify }}><div inert={syncStatus === "loading"}>{children}</div>{syncStatus === "loading" ? <div className="v2-refresh-notice" role="status">최신 데이터를 확인하는 중…</div> : null}</DashboardContext.Provider>
      : <div className="v2-loading" role="status">공유 작업 공간을 불러오고 있어요…</div>}
    {notice ? <div role={notice.error ? "alert" : "status"} className={`v2-toast ${notice.error ? "error" : ""}`}><span>{notice.error ? "!" : "✓"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div> : null}
  </>;
}

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("DashboardProvider가 필요합니다.");
  return value;
}

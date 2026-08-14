"use client";

import { ChangeEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShippingWorkspace, {
  ShippingCounts,
  ShippingSummary,
  ShippingTab,
} from "./shipping/ShippingWorkspace";
import {
  canonicalInstagramId,
  readShippingRounds,
  ShippingRound,
} from "./shipping/shipping-data";

type PurchaseItem = {
  clothingNo?: string;
  rawPrice: string;
  quantity: number;
  price: number;
};

type BuyerSummary = {
  nickname: string;
  quantity: number;
  total: number;
  items: PurchaseItem[];
};

type PriceEntry = {
  clothingNo?: string;
  rawPrice: string;
  quantity: number;
};

type SortMode = "memo" | "name" | "amountAsc" | "amountDesc";
type ViewMode = "memo" | "list";
type AppHistoryState = {
  unclozetView?: ViewMode;
  activeSessionId?: string | null;
};
type AppRouteState = {
  viewMode: ViewMode;
  activeSessionId: string | null;
};
type SwipeState = {
  id: string;
  startX: number;
  deltaX: number;
};

type SavedSession = {
  id: string;
  title: string;
  memo: string;
  paidNicknames: string[];
  createdAt: string;
  updatedAt: string;
};

const MEMO_STORAGE_KEY = "unclozet-live-memo";
const PAID_STORAGE_KEY = "unclozet-live-paid-nicknames";
const SAVED_SESSIONS_STORAGE_KEY = "unclozet-live-saved-sessions";
const ACTIVE_SESSION_STORAGE_KEY = "unclozet-live-active-session-id";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function normalizePrice(value: string) {
  const compact = value.replace(/,/g, "");
  const numericValue = Number(compact);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (compact.includes(".") || numericValue < 50) {
    return Math.round(numericValue * 10000);
  }

  if (numericValue >= 1000) {
    return Math.round(numericValue);
  }

  return Math.round(numericValue * 10000);
}

function parseMemoLine(line: string) {
  const match = line.match(/^\s*(.*?)\s*[:\-–—]\s*(.+?)\s*$/);

  if (!match) {
    return null;
  }

  const nickname = match[1].trim();
  const content = match[2].trim();

  if (!nickname || !content) {
    return null;
  }

  const numberedMatches = Array.from(content.matchAll(/(\d+)\s*번\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*[*xX×]\s*(\d+))?/g));
  const priceEntries: PriceEntry[] =
    numberedMatches.length > 0
      ? numberedMatches.map((match) => ({
          clothingNo: match[1],
          rawPrice: match[2].replace(",", "."),
          quantity: Number(match[3] ?? "1"),
        }))
      : Array.from(content.matchAll(/([0-9]+(?:[.,][0-9]+)?)(?:\s*[*xX×]\s*(\d+))?/g)).map((match) => ({
          rawPrice: match[1].replace(",", "."),
          quantity: Number(match[2] ?? "1"),
        }));

  if (priceEntries.length === 0) {
    return null;
  }

  const items = priceEntries.map((entry) => ({
    clothingNo: entry.clothingNo,
    rawPrice: entry.rawPrice,
    quantity: Number.isFinite(entry.quantity) && entry.quantity > 0 ? Math.floor(entry.quantity) : 1,
    price: normalizePrice(entry.rawPrice),
  }));

  return {
    nickname,
    items,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
}

function parseMemo(text: string): BuyerSummary[] {
  const summaries = new Map<string, BuyerSummary>();

  text.split("\n").forEach((line) => {
    const parsedLine = parseMemoLine(line);

    if (!parsedLine) {
      return;
    }

    const previous = summaries.get(parsedLine.nickname) ?? {
      nickname: parsedLine.nickname,
      quantity: 0,
      total: 0,
      items: [],
    };

    parsedLine.items.forEach((item) => {
      previous.items.push(item);
      previous.quantity += item.quantity;
      previous.total += item.price * item.quantity;
    });

    summaries.set(parsedLine.nickname, previous);
  });

  return Array.from(summaries.values());
}

function won(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function itemLabel(item: PurchaseItem) {
  const priceLabel = item.clothingNo ? `${item.clothingNo}번 ${won(item.price)}` : won(item.price);

  return item.quantity > 1 ? `${priceLabel} x ${item.quantity}` : priceLabel;
}

function numberWithComma(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function memoWithLineTotals(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const parsedLine = parseMemoLine(line);

      if (!parsedLine) {
        return line;
      }

      return `${line.trim()} = ${numberWithComma(parsedLine.total)}`;
    })
    .join("\n");
}

function escapeCsvCell(value: string | number) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function defaultSessionTitle(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function localDateId(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pruneOldSessions(sessions: SavedSession[]) {
  const threshold = Date.now() - ONE_WEEK_MS;
  return sessions.filter((session) => new Date(session.updatedAt).getTime() >= threshold);
}

function sortSavedSessions(sessions: SavedSession[]) {
  return [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function routePath(viewMode: ViewMode, activeSessionId: string | null) {
  if (viewMode === "list") {
    return "/list";
  }

  return activeSessionId ? `/memo/${encodeURIComponent(activeSessionId)}` : "/";
}

function parseRoutePath(pathname: string): AppRouteState {
  if (pathname === "/list") {
    return { viewMode: "list", activeSessionId: null };
  }

  const memoMatch = pathname.match(/^\/memo\/([^/]+)$/);

  if (memoMatch) {
    return { viewMode: "memo", activeSessionId: decodeURIComponent(memoMatch[1]) };
  }

  return { viewMode: "memo", activeSessionId: null };
}

function readLocalSessions() {
  const saved = window.localStorage.getItem(SAVED_SESSIONS_STORAGE_KEY);

  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return pruneOldSessions(
      parsed.filter((session): session is SavedSession => {
        return (
          typeof session?.id === "string" &&
          typeof session?.title === "string" &&
          typeof session?.memo === "string" &&
          Array.isArray(session?.paidNicknames) &&
          typeof session?.createdAt === "string" &&
          typeof session?.updatedAt === "string"
        );
      }),
    );
  } catch {
    return [];
  }
}

async function fetchRemoteSessions() {
  if (!hasSupabase) {
    return [];
  }

  const since = new Date(Date.now() - ONE_WEEK_MS).toISOString();
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/live_memos?updated_at=gte.${encodeURIComponent(since)}&order=updated_at.desc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to load remote sessions");
  }

  const rows = await response.json();

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row): SavedSession => {
    const paidNicknames = Array.isArray(row.paid_nicknames)
      ? row.paid_nicknames.filter((value: unknown) => typeof value === "string")
      : [];

    return {
      id: String(row.id),
      title: String(row.title ?? defaultSessionTitle()),
      memo: String(row.memo ?? ""),
      paidNicknames,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
}

async function deleteRemoteOldSessions() {
  if (!hasSupabase) {
    return;
  }

  const since = new Date(Date.now() - ONE_WEEK_MS).toISOString();

  await fetch(`${SUPABASE_URL}/rest/v1/live_memos?updated_at=lt.${encodeURIComponent(since)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

async function saveRemoteSession(session: SavedSession) {
  if (!hasSupabase) {
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/live_memos?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: session.id,
      title: session.title,
      memo: session.memo,
      paid_nicknames: session.paidNicknames,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    }),
  });
}

async function deleteRemoteSession(id: string) {
  if (!hasSupabase) {
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/live_memos?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

export default function Home() {
  const [memo, setMemo] = useState("");
  const [generatedMemo, setGeneratedMemo] = useState("");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("memo");
  const [viewMode, setViewMode] = useState<ViewMode>("memo");
  const [shippingTab, setShippingTab] = useState<ShippingTab>("waiting");
  const [shippingCounts, setShippingCounts] = useState<ShippingCounts>({ waiting: 0, ready: 0, completed: 0 });
  const [shippingRounds, setShippingRounds] = useState<ShippingRound[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [paidNicknames, setPaidNicknames] = useState<Set<string>>(new Set());
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [activeMemoMatchIndex, setActiveMemoMatchIndex] = useState(-1);
  const [swipedSessionId, setSwipedSessionId] = useState<string | null>(null);
  const [swipeState, setSwipeState] = useState<SwipeState | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isGnbVisible, setIsGnbVisible] = useState(true);
  const [gnbHeight, setGnbHeight] = useState(0);
  const [isSaveToastVisible, setIsSaveToastVisible] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedSessionsRef = useRef<SavedSession[]>([]);
  const hasInitializedHistoryRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const saveToastTimerRef = useRef<number | null>(null);

  const summaries = useMemo(() => parseMemo(memo), [memo]);
  const sortedSummaries = useMemo(() => {
    const nextSummaries = [...summaries];

    if (sortMode === "name") {
      nextSummaries.sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"));
    }

    if (sortMode === "amountAsc") {
      nextSummaries.sort((a, b) => a.total - b.total || a.nickname.localeCompare(b.nickname, "ko"));
    }

    if (sortMode === "amountDesc") {
      nextSummaries.sort((a, b) => b.total - a.total || a.nickname.localeCompare(b.nickname, "ko"));
    }

    return nextSummaries;
  }, [sortMode, summaries]);

  const searchFilteredSummaries = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return sortedSummaries;
    }

    return sortedSummaries.filter((summary) => {
      const nicknameMatched = summary.nickname.toLowerCase().includes(keyword);
      const itemMatched = summary.items.some((item) => {
        const itemNo = item.clothingNo ? `${item.clothingNo}번`.toLowerCase() : "";
        const priceText = `${item.rawPrice} ${item.price} ${won(item.price)}`.toLowerCase();
        return itemNo.includes(keyword) || priceText.includes(keyword);
      });

      return nicknameMatched || itemMatched;
    });
  }, [query, sortedSummaries]);

  const grandQuantity = summaries.reduce((sum, summary) => sum + summary.quantity, 0);
  const grandTotal = summaries.reduce((sum, summary) => sum + summary.total, 0);
  const activeSession = savedSessions.find((session) => session.id === activeSessionId);
  const pageTitle = activeSession?.title ?? draftTitle;
  const shippingDateId = localDateId(activeSession ? new Date(activeSession.createdAt) : new Date());
  const shippingSummaries = useMemo<ShippingSummary[]>(
    () => searchFilteredSummaries.map((summary) => ({
      instagramId: summary.nickname,
      quantity: summary.quantity,
      totalLabel: won(summary.total),
      items: summary.items.map(itemLabel),
    })),
    [searchFilteredSummaries],
  );

  const memoMatches = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return [];
    }

    const matches: Array<{ start: number; end: number }> = [];
    const source = memo.toLowerCase();
    let start = source.indexOf(keyword);

    while (start !== -1) {
      matches.push({ start, end: start + keyword.length });
      start = source.indexOf(keyword, start + keyword.length);
    }

    return matches;
  }, [memo, query]);

  const selectMemoMatch = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      const match = memoMatches[index];

      if (!textarea || !match) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
    },
    [memoMatches],
  );

  const focusTextareaEnd = () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  useEffect(() => {
    setActiveMemoMatchIndex(-1);
  }, [query]);

  useEffect(() => {
    savedSessionsRef.current = savedSessions;
  }, [savedSessions]);

  useEffect(() => {
    const updateHeaderHeight = () => {
      setGnbHeight(headerRef.current?.offsetHeight ?? 0);
    };

    updateHeaderHeight();
    window.addEventListener("resize", updateHeaderHeight);

    const resizeObserver =
      typeof ResizeObserver !== "undefined" && headerRef.current ? new ResizeObserver(updateHeaderHeight) : null;

    if (headerRef.current) {
      resizeObserver?.observe(headerRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateHeaderHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollYRef.current;

      if (currentScrollY < 8) {
        setIsGnbVisible(true);
      } else if (scrollDelta > 8) {
        setIsGnbVisible(false);
      } else if (scrollDelta < -4) {
        setIsGnbVisible(true);
      }

      lastScrollYRef.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const savedMemo = window.localStorage.getItem(MEMO_STORAGE_KEY);
    const savedPaidNicknames = window.localStorage.getItem(PAID_STORAGE_KEY);
    const savedActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    const localSessions = readLocalSessions();
    const initialRoute = parseRoutePath(window.location.pathname);
    const routeSession = initialRoute.activeSessionId
      ? localSessions.find((session) => session.id === initialRoute.activeSessionId)
      : undefined;

    setDraftTitle(defaultSessionTitle());

    if (routeSession) {
      setMemo(routeSession.memo);
      setGeneratedMemo(memoWithLineTotals(routeSession.memo));
      setPaidNicknames(new Set(routeSession.paidNicknames));
      setActiveSessionId(routeSession.id);
    } else if (savedMemo) {
      setMemo(savedMemo);
    }

    if (!routeSession && savedPaidNicknames) {
      try {
        const parsed = JSON.parse(savedPaidNicknames);

        if (Array.isArray(parsed)) {
          setPaidNicknames(new Set(parsed.filter((value) => typeof value === "string")));
        }
      } catch {
        setPaidNicknames(new Set());
      }
    }

    setSavedSessions(sortSavedSessions(localSessions));
    setShippingRounds(readShippingRounds());
    window.localStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, JSON.stringify(sortSavedSessions(localSessions)));

    if (initialRoute.viewMode === "list") {
      setViewMode("list");
    }

    if (!routeSession && savedActiveSessionId && localSessions.some((session) => session.id === savedActiveSessionId)) {
      setActiveSessionId(savedActiveSessionId);
    }

    setHasLoadedStorage(true);

    deleteRemoteOldSessions().catch(() => undefined);

    fetchRemoteSessions()
      .then((remoteSessions) => {
        if (remoteSessions.length === 0) {
          return;
        }

        if (initialRoute.activeSessionId && !routeSession) {
          const remoteRouteSession = remoteSessions.find((session) => session.id === initialRoute.activeSessionId);

          if (remoteRouteSession) {
            setMemo(remoteRouteSession.memo);
            setGeneratedMemo(memoWithLineTotals(remoteRouteSession.memo));
            setPaidNicknames(new Set(remoteRouteSession.paidNicknames));
            setActiveSessionId(remoteRouteSession.id);
          }
        }

        setSavedSessions((current) => {
          const merged = new Map<string, SavedSession>();

          [...current, ...remoteSessions].forEach((session) => {
            const existing = merged.get(session.id);

            if (!existing || new Date(session.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
              merged.set(session.id, session);
            }
          });

          return sortSavedSessions(pruneOldSessions(Array.from(merged.values())));
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    window.localStorage.setItem(MEMO_STORAGE_KEY, memo);
  }, [hasLoadedStorage, memo]);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    window.localStorage.setItem(PAID_STORAGE_KEY, JSON.stringify(Array.from(paidNicknames)));
  }, [hasLoadedStorage, paidNicknames]);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    window.localStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, JSON.stringify(savedSessions));
  }, [hasLoadedStorage, savedSessions]);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  }, [activeSessionId, hasLoadedStorage]);

  useEffect(() => {
    if (!hasLoadedStorage || !activeSessionId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      let nextSession: SavedSession | undefined;

      setSavedSessions((current) => {
        const existing = current.find((session) => session.id === activeSessionId);

        if (!existing) {
          return current;
        }

        nextSession = {
          ...existing,
          memo,
          paidNicknames: Array.from(paidNicknames),
          updatedAt: new Date().toISOString(),
        };

        return sortSavedSessions(current.map((session) => (session.id === activeSessionId ? nextSession! : session)));
      });

      if (nextSession) {
        saveRemoteSession(nextSession).catch(() => undefined);
      }
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [activeSessionId, hasLoadedStorage, memo, paidNicknames]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;

      if (state?.unclozetView === "list" || state?.unclozetView === "memo") {
        const session = state.activeSessionId
          ? savedSessionsRef.current.find((savedSession) => savedSession.id === state.activeSessionId)
          : undefined;

        if (session) {
          setMemo(session.memo);
          setGeneratedMemo(memoWithLineTotals(session.memo));
          setPaidNicknames(new Set(session.paidNicknames));
        }

        setViewMode(state.unclozetView);
        setActiveSessionId(state.activeSessionId ?? null);
        setShippingTab("waiting");
        setQuery("");
        setIsSearchOpen(false);
        setDeleteTargetId(null);
        setSwipeState(null);
        setSwipedSessionId(null);

        if (state.unclozetView === "memo") {
          requestAnimationFrame(focusTextareaEnd);
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage || hasInitializedHistoryRef.current) {
      return;
    }

    hasInitializedHistoryRef.current = true;
    window.history.replaceState(
      { ...(window.history.state ?? {}), unclozetView: viewMode, activeSessionId },
      "",
      routePath(viewMode, activeSessionId),
    );
  }, [activeSessionId, hasLoadedStorage, viewMode]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setIsSearchOpen(false);
      requestAnimationFrame(focusTextareaEnd);
      return;
    }

    if (event.key === "Enter" && memoMatches.length > 0) {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex = (activeMemoMatchIndex + direction + memoMatches.length) % memoMatches.length;

      setActiveMemoMatchIndex(nextIndex);
      requestAnimationFrame(() => selectMemoMatch(nextIndex));
    }
  };

  const moveMemoMatch = (direction: -1 | 1) => {
    if (memoMatches.length === 0) {
      return;
    }

    const nextIndex = (activeMemoMatchIndex + direction + memoMatches.length) % memoMatches.length;
    setActiveMemoMatchIndex(nextIndex);
    requestAnimationFrame(() => selectMemoMatch(nextIndex));
  };

  const navigateToView = (nextViewMode: ViewMode, nextActiveSessionId = activeSessionId) => {
    if (nextViewMode === "list") {
      setQuery("");
      setIsSearchOpen(false);
      setShippingRounds(readShippingRounds());
    }
    setViewMode(nextViewMode);
    window.history.pushState(
      { ...(window.history.state ?? {}), unclozetView: nextViewMode, activeSessionId: nextActiveSessionId },
      "",
      routePath(nextViewMode, nextActiveSessionId),
    );
  };

  const replaceCurrentHistoryEntry = (nextViewMode: ViewMode, nextActiveSessionId: string | null) => {
    window.history.replaceState(
      { ...(window.history.state ?? {}), unclozetView: nextViewMode, activeSessionId: nextActiveSessionId },
      "",
      routePath(nextViewMode, nextActiveSessionId),
    );
  };

  const deleteTarget = savedSessions.find((session) => session.id === deleteTargetId);

  const requestDeleteSession = (id: string) => {
    setDeleteTargetId(id);
  };

  const cancelDeleteSession = () => {
    setDeleteTargetId(null);
  };

  const confirmDeleteSession = () => {
    if (!deleteTargetId) {
      return;
    }

    const id = deleteTargetId;

    setSavedSessions((current) => current.filter((session) => session.id !== id));
    setSwipedSessionId(null);
    setSwipeState(null);
    setDeleteTargetId(null);

    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMemo("");
      setGeneratedMemo("");
      setPaidNicknames(new Set());
      setDraftTitle(defaultSessionTitle());
    }

    deleteRemoteSession(id).catch(() => undefined);
  };

  const handleSessionPointerDown = (id: string, event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest("button, input")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSwipeState({ id, startX: event.clientX, deltaX: 0 });
  };

  const handleSessionPointerMove = (id: string, event: PointerEvent<HTMLElement>) => {
    if (swipeState?.id !== id) {
      return;
    }

    const deltaX = Math.min(0, Math.max(event.clientX - swipeState.startX, -128));
    setSwipeState({ ...swipeState, deltaX });
  };

  const handleSessionPointerEnd = (id: string) => {
    if (swipeState?.id !== id) {
      return;
    }

    setSwipedSessionId(swipeState.deltaX <= -44 ? id : null);
    setSwipeState(null);
  };

  const saveCurrentSession = () => {
    const now = new Date();
    const paidList = Array.from(paidNicknames);

    if (saveToastTimerRef.current) {
      window.clearTimeout(saveToastTimerRef.current);
    }
    setIsSaveToastVisible(true);
    saveToastTimerRef.current = window.setTimeout(() => {
      setIsSaveToastVisible(false);
      saveToastTimerRef.current = null;
    }, 1600);

    if (activeSession) {
      const nextSession = {
        ...activeSession,
        memo,
        paidNicknames: paidList,
        updatedAt: now.toISOString(),
      };

      setSavedSessions((current) =>
        sortSavedSessions(current.map((session) => (session.id === activeSession.id ? nextSession : session))),
      );
      replaceCurrentHistoryEntry("memo", activeSession.id);
      saveRemoteSession(nextSession).catch(() => undefined);
      return;
    }

    const nextSession = {
      id: crypto.randomUUID(),
      title: draftTitle || defaultSessionTitle(now),
      memo,
      paidNicknames: paidList,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setActiveSessionId(nextSession.id);
    setSavedSessions((current) => sortSavedSessions([nextSession, ...current]));
    replaceCurrentHistoryEntry("memo", nextSession.id);
    saveRemoteSession(nextSession).catch(() => undefined);
  };

  const loadSession = (session: SavedSession) => {
    setMemo(session.memo);
    setGeneratedMemo(memoWithLineTotals(session.memo));
    setPaidNicknames(new Set(session.paidNicknames));
    setActiveSessionId(session.id);
    navigateToView("memo", session.id);
    setShippingTab("waiting");
    setQuery("");
  };

  const updateSessionTitle = (id: string, title: string) => {
    const updatedAt = new Date().toISOString();
    const existing = savedSessions.find((session) => session.id === id);

    if (!existing) {
      return;
    }

    const nextSession = {
      ...existing,
      title,
      updatedAt,
    };

    setSavedSessions((current) =>
      sortSavedSessions(current.map((session) => (session.id === id ? nextSession : session))),
    );
    saveRemoteSession(nextSession).catch(() => undefined);
  };

  const startNewMemo = () => {
    setMemo("");
    setGeneratedMemo("");
    setPaidNicknames(new Set());
    setActiveSessionId(null);
    setDraftTitle(defaultSessionTitle());
    setShippingTab("waiting");
    setQuery("");
    navigateToView("memo", null);
    requestAnimationFrame(focusTextareaEnd);
  };

  const handleGenerateMemoWithTotals = () => {
    setGeneratedMemo(memoWithLineTotals(memo));
  };

  const handleCopyGeneratedMemo = () => {
    if (!generatedMemo) {
      return;
    }

    navigator.clipboard?.writeText(generatedMemo).catch(() => undefined);
  };

  const toggleSearch = () => {
    if (isSearchOpen) {
      setIsSearchOpen(false);
      setQuery("");
      requestAnimationFrame(focusTextareaEnd);
      return;
    }

    setIsSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const handleShippingCountsChange = useCallback((counts: ShippingCounts) => {
    setShippingCounts(counts);
    setShippingRounds(readShippingRounds());
  }, []);

  return (
    <main className="min-h-dvh bg-[#FAFAFA] pb-8 text-[#0A0A0A]" style={{ paddingTop: gnbHeight }}>
      <header
        ref={headerRef}
        className={`fixed inset-x-0 top-0 z-30 border-b border-[#E8E8EC] bg-white px-3 py-3 transition-transform duration-200 md:px-6 ${
          isGnbVisible ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-['General_Sans'] text-[24px] font-bold leading-tight text-[#0A0A0A] md:text-[32px]">
              {viewMode === "list" ? "저장 리스트" : pageTitle}
            </h1>
            <p className="mt-1 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
              {viewMode === "list"
                ? `최근 7일 기준 · ${hasSupabase ? "Supabase 연결됨" : "이 브라우저에 저장 중"}`
                : activeSession
                  ? "자동 저장 중"
                  : "저장 전 임시 저장 중"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === "memo" ? (
              <button
                type="button"
                onClick={toggleSearch}
                aria-expanded={isSearchOpen}
                className="h-10 rounded-md border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1]"
              >
                검색
              </button>
            ) : null}
            {viewMode === "memo" ? (
              <button
                type="button"
                onClick={() => navigateToView("list")}
                className="h-10 rounded-md border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1]"
              >
                리스트
              </button>
            ) : null}
            {viewMode === "memo" ? (
              <button
                type="button"
                onClick={saveCurrentSession}
                disabled={!memo.trim()}
                className="h-10 rounded-md bg-[#6366F1] px-4 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5] hover:shadow-[0_4px_12px_rgba(99,102,241,0.35)] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C] disabled:shadow-none"
              >
                저장
              </button>
            ) : (
              <button
                type="button"
                onClick={startNewMemo}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[#6366F1] px-4 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5]"
              >
                <span aria-hidden="true" className="text-[19px] leading-none">+</span>
                새 메모
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        aria-live="polite"
        className={`pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2 transition duration-200 ${
          isSaveToastVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <div className="rounded-full border border-[#E8E8EC] bg-[#0A0A0A] px-4 py-2 font-['DM_Sans'] text-[14px] font-bold text-white shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
          저장 완료
        </div>
      </div>

      {viewMode === "memo" && isSearchOpen ? (
        <div
          className="border-b border-[#E8E8EC] bg-white px-3 py-3 md:px-6"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <label className="sr-only" htmlFor="search">
              검색
            </label>
            <input
              ref={searchRef}
              id="search"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-12 flex-1 rounded-xl border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[15px] font-medium text-[#0A0A0A] outline-none transition focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15"
              placeholder="닉네임 또는 금액 검색"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setQuery("")}
              className="h-10 rounded-md border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#6B6B6B] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1]"
            >
              지우기
            </button>
          </div>
          <div className="mx-auto mt-3 flex max-w-7xl items-center justify-between gap-3 font-['JetBrains_Mono'] text-[12px] text-[#6B6B6B]">
            <span className="rounded-full bg-[#F1F1F4] px-3 py-1">
              메모 {memoMatches.length}건 · 카드 {searchFilteredSummaries.length}명
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => moveMemoMatch(-1)}
                disabled={memoMatches.length === 0}
                className="h-8 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B] transition hover:-translate-y-px hover:bg-[#F6F6F8] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C]"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => moveMemoMatch(1)}
                disabled={memoMatches.length === 0}
                className="h-8 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B] transition hover:-translate-y-px hover:bg-[#F6F6F8] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C]"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewMode === "list" ? (
        <section className="mx-auto grid max-w-7xl gap-4 px-3 pt-5 md:px-6 md:pt-8">
          {savedSessions.length > 0 ? (
            savedSessions.map((session) => {
              const sessionSummaries = parseMemo(session.memo);
              const sessionParticipantIds = new Set(
                sessionSummaries.map((summary) => canonicalInstagramId(summary.nickname)),
              );
              const sessionRound = shippingRounds.find(
                (round) => round.id === localDateId(new Date(session.createdAt)),
              );
              const waitingCount = sessionRound
                ? sessionRound.participants.filter(
                    (participant) =>
                      participant.status === "WAITING" &&
                      sessionParticipantIds.has(canonicalInstagramId(participant.instagramId)),
                  ).length
                : sessionSummaries.length;

              return (
                <div key={session.id} className="relative overflow-hidden rounded-xl bg-[#EF4444]">
                  <button
                    type="button"
                    onClick={() => requestDeleteSession(session.id)}
                    className="absolute inset-y-0 right-0 w-28 font-['DM_Sans'] text-[14px] font-bold text-white"
                  >
                    삭제
                  </button>
                  <article
                    onPointerDown={(event) => handleSessionPointerDown(session.id, event)}
                    onPointerMove={(event) => handleSessionPointerMove(session.id, event)}
                    onPointerUp={() => handleSessionPointerEnd(session.id)}
                    onPointerCancel={() => setSwipeState(null)}
                    className="touch-pan-y rounded-xl border border-[#E8E8EC] bg-white p-5 transition-transform"
                    style={{
                      transform: `translateX(${
                        swipeState?.id === session.id ? swipeState.deltaX : swipedSessionId === session.id ? -112 : 0
                      }px)`,
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <label className="sr-only" htmlFor={`title-${session.id}`}>
                          리스트 이름
                        </label>
                        <input
                          id={`title-${session.id}`}
                          value={session.title}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => updateSessionTitle(session.id, event.target.value)}
                          className="w-full rounded-md border border-transparent bg-transparent px-0 font-['General_Sans'] text-[22px] font-bold leading-tight text-[#0A0A0A] outline-none transition focus:border-[#6366F1] focus:bg-white focus:px-3 focus:ring-[3px] focus:ring-[#6366F1]/15"
                        />
                        <p className="mt-2 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
                          {sessionSummaries.length}명 · 미입금 {waitingCount}명
                        </p>
                        <p className="mt-1 font-['JetBrains_Mono'] text-[12px] text-[#9C9C9C]">
                          저장 {new Date(session.updatedAt).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadSession(session)}
                        className="h-11 rounded-md bg-[#6366F1] px-5 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5]"
                      >
                        열기
                      </button>
                    </div>
                  </article>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-[#E8E8EC] bg-white p-8 text-center font-['DM_Sans'] text-[14px] font-medium text-[#9C9C9C]">
              저장된 리스트가 없습니다.
            </div>
          )}
        </section>
      ) : (
        <section className="mx-auto grid max-w-7xl gap-5 px-3 pt-5 md:px-6 md:pt-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
            <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
              <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">고객</p>
              <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#0A0A0A] md:text-[32px]">{summaries.length}명</p>
            </div>
            <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
              <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">수량</p>
              <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#0A0A0A] md:text-[32px]">{grandQuantity}개</p>
            </div>
            <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
              <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">미입금</p>
              <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#EF4444] md:text-[32px]">{shippingCounts.waiting}명</p>
            </div>
            <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
              <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">합계</p>
              <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#6366F1] md:text-[32px]">{won(grandTotal)}</p>
            </div>
          </div>

          <div
            className={`grid gap-3 rounded-xl border border-[#E8E8EC] bg-white p-3 md:p-4 ${
              generatedMemo ? "md:grid-cols-2 md:gap-4" : ""
            }`}
          >
            <div className="grid min-w-0 grid-rows-[1fr_auto] gap-3">
              <textarea
                ref={textareaRef}
                value={memo}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMemo(event.target.value)}
                className="min-h-40 w-full resize-y rounded-lg border border-[#E8E8EC] bg-white p-4 font-['JetBrains_Mono'] text-[16px] leading-7 text-[#0A0A0A] outline-none transition placeholder:text-[#9C9C9C] focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15 md:min-h-48 md:text-[17px]"
                placeholder="예: 홍길동 - 1.5 + 2.0 + 0.5"
                spellCheck={false}
              />
              {!generatedMemo ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateMemoWithTotals}
                    disabled={!memo.trim()}
                    className="h-11 rounded-md bg-[#6366F1] px-5 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C]"
                  >
                    확인
                  </button>
                </div>
              ) : null}
            </div>
            {generatedMemo ? (
              <div className="grid min-w-0 grid-rows-[auto_1fr] gap-2 border-t border-[#E8E8EC] pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">합계 포함 복사용 메모</p>
                  <button
                    type="button"
                    onClick={handleCopyGeneratedMemo}
                    className="h-9 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[13px] font-medium text-[#0A0A0A] transition hover:border-[#6366F1] hover:text-[#6366F1]"
                  >
                    복사
                  </button>
                </div>
                <textarea
                  value={generatedMemo}
                  readOnly
                  className="min-h-40 h-full w-full resize-y rounded-lg border border-[#E8E8EC] bg-[#FAFAFA] p-4 font-['JetBrains_Mono'] text-[15px] leading-7 text-[#0A0A0A] outline-none md:min-h-48"
                />
              </div>
            ) : null}
          </div>

          <section>
            <ShippingWorkspace
              dateId={shippingDateId}
              summaries={shippingSummaries}
              tab={shippingTab}
              onTabChange={setShippingTab}
              onCountsChange={handleShippingCountsChange}
              sortControl={(
                <>
                  <label className="sr-only" htmlFor="sort">정렬</label>
                  <select
                    id="sort"
                    value={sortMode}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortMode(event.target.value as SortMode)}
                    className="h-11 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] outline-none transition focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15"
                  >
                    <option value="memo">메모 순서</option>
                    <option value="name">가나다순</option>
                    <option value="amountAsc">금액 오름차순</option>
                    <option value="amountDesc">금액 내림차순</option>
                  </select>
                </>
              )}
            />
          </section>
        </section>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl border border-[#E8E8EC] bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
            <h2 className="font-['General_Sans'] text-[22px] font-bold leading-tight text-[#0A0A0A]">리스트 삭제</h2>
            <p className="mt-2 font-['DM_Sans'] text-[14px] font-medium leading-6 text-[#6B6B6B]">
              {deleteTarget.title} 리스트를 삭제할까요?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDeleteSession}
                className="h-10 rounded-md border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:border-[#6366F1] hover:text-[#6366F1]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDeleteSession}
                className="h-10 rounded-md bg-[#EF4444] px-4 font-['DM_Sans'] text-[14px] font-bold text-white transition hover:bg-[#DC2626]"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

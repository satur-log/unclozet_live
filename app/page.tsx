"use client";

import { ChangeEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShippingWorkspace, {
  ShippingCounts,
  ShippingSummary,
  ShippingTab,
} from "./shipping/ShippingWorkspace";
import {
  canonicalInstagramId,
  deleteRemoteShippingRound,
  fetchRemoteShippingRounds,
  mergeShippingRounds,
  readShippingRounds,
  saveRemoteShippingRound,
  ShippingRound,
  writeShippingRounds,
} from "./shipping/shipping-data";

function HeaderIcon({ type }: { type: "search" | "list" | "save" }) {
  if (type === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4.5-4.5" />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

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
type ViewMode = "memo" | "list" | "orders";
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
const SHIPPING_ROUNDS_STORAGE_KEY = "unclozet-shipping-rounds-v1";
const LOCAL_DATA_STORAGE_KEYS = [
  MEMO_STORAGE_KEY,
  PAID_STORAGE_KEY,
  SAVED_SESSIONS_STORAGE_KEY,
  ACTIVE_SESSION_STORAGE_KEY,
  SHIPPING_ROUNDS_STORAGE_KEY,
];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseRestBase = SUPABASE_URL
  ? SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "")
  : "";
const hasSupabase = Boolean(supabaseRestBase && SUPABASE_ANON_KEY);
const EMPTY_SHIPPING_SUMMARIES: ShippingSummary[] = [];

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

function sortSavedSessions(sessions: SavedSession[]) {
  return [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function haveSameNicknames(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((nickname) => rightSet.has(nickname));
}

function routePath(viewMode: ViewMode, activeSessionId: string | null) {
  if (viewMode === "list") {
    return "/list";
  }

  if (viewMode === "orders") {
    return activeSessionId ? `/orders/${encodeURIComponent(activeSessionId)}` : "/orders";
  }

  return activeSessionId ? `/memo/${encodeURIComponent(activeSessionId)}` : "/";
}

function parseRoutePath(pathname: string): AppRouteState {
  if (pathname === "/list") {
    return { viewMode: "list", activeSessionId: null };
  }

  if (pathname === "/orders") {
    return { viewMode: "orders", activeSessionId: null };
  }

  const orderMatch = pathname.match(/^\/orders\/([^/]+)$/);

  if (orderMatch) {
    return { viewMode: "orders", activeSessionId: decodeURIComponent(orderMatch[1]) };
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

    return parsed.filter((session): session is SavedSession => {
      return (
        typeof session?.id === "string" &&
        typeof session?.title === "string" &&
        typeof session?.memo === "string" &&
        Array.isArray(session?.paidNicknames) &&
        typeof session?.createdAt === "string" &&
        typeof session?.updatedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

async function fetchRemoteSessions() {
  if (!hasSupabase) {
    return [];
  }

  const response = await fetch(
    `${supabaseRestBase}/rest/v1/live_memos?order=created_at.desc`,
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

async function saveRemoteSession(session: SavedSession) {
  if (!hasSupabase) {
    return;
  }

  const response = await fetch(`${supabaseRestBase}/rest/v1/live_memos?on_conflict=id`, {
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

  if (!response.ok) {
    throw new Error("Failed to save remote session");
  }
}

async function deleteRemoteSession(id: string) {
  if (!hasSupabase) {
    return;
  }

  const response = await fetch(`${supabaseRestBase}/rest/v1/live_memos?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to delete remote session");
  }
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
  const [isStandaloneOrdersVisible, setIsStandaloneOrdersVisible] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMemoComposerCollapsed, setIsMemoComposerCollapsed] = useState(false);
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
  const shippingDateId = activeSessionId ? `memo-${activeSessionId}` : `draft-${localDateId(new Date())}`;
  const standaloneOrderRounds = useMemo(
    () =>
      shippingRounds
        .filter((round) => round.id.startsWith("standalone-orders-") && round.participants.length > 0)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [shippingRounds],
  );
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
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    setIsStandaloneOrdersVisible(isLocalhost);

    if (!isLocalhost && parseRoutePath(window.location.pathname).viewMode === "orders") {
      replaceCurrentHistoryEntry("memo", null);
      setViewMode("memo");
      setActiveSessionId(null);
    }
  }, []);

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
    const searchParams = new URLSearchParams(window.location.search);

    const shouldClearLocalData = searchParams.get("clearLocalData") === "1";

    if (shouldClearLocalData) {
      LOCAL_DATA_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
      window.history.replaceState(window.history.state, "", "/");
    }

    const savedMemo = window.localStorage.getItem(MEMO_STORAGE_KEY);
    const savedPaidNicknames = window.localStorage.getItem(PAID_STORAGE_KEY);
    const savedActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    const localSessions = readLocalSessions();
    const localShippingRounds = readShippingRounds();
    const initialRoute = parseRoutePath(window.location.pathname);
    const routeSession = initialRoute.activeSessionId
      ? localSessions.find((session) => session.id === initialRoute.activeSessionId)
      : undefined;

    setDraftTitle(defaultSessionTitle());

    if (routeSession) {
      setMemo(routeSession.memo);
      setGeneratedMemo(memoWithLineTotals(routeSession.memo));
      setIsMemoComposerCollapsed(true);
      setPaidNicknames(new Set(routeSession.paidNicknames));
      setActiveSessionId(routeSession.id);
    } else if (savedMemo) {
      setMemo(savedMemo);
      setIsMemoComposerCollapsed(false);
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
    setShippingRounds(localShippingRounds);
    window.localStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, JSON.stringify(sortSavedSessions(localSessions)));

    if (initialRoute.viewMode === "list" || initialRoute.viewMode === "orders") {
      setViewMode(initialRoute.viewMode);
    }

    if (initialRoute.viewMode === "orders" && initialRoute.activeSessionId) {
      setActiveSessionId(initialRoute.activeSessionId);
    }

    if (initialRoute.viewMode !== "orders" && !routeSession && savedActiveSessionId && localSessions.some((session) => session.id === savedActiveSessionId)) {
      setActiveSessionId(savedActiveSessionId);
    }

    setHasLoadedStorage(true);

    if (shouldClearLocalData) {
      return;
    }

    Promise.all([fetchRemoteSessions(), fetchRemoteShippingRounds()])
      .then(([remoteSessions, remoteShippingRounds]) => {
        localSessions.forEach((session) => {
          saveRemoteSession(session).catch(() => undefined);
        });
        localShippingRounds.forEach((round) => {
          saveRemoteShippingRound(round).catch(() => undefined);
        });

        if (remoteShippingRounds.length > 0) {
          const mergedShippingRounds = mergeShippingRounds(localShippingRounds, remoteShippingRounds);
          writeShippingRounds(mergedShippingRounds);
          setShippingRounds(mergedShippingRounds);
        }

        if (remoteSessions.length > 0 && initialRoute.activeSessionId && !routeSession) {
          const remoteRouteSession = remoteSessions.find((session) => session.id === initialRoute.activeSessionId);

          if (remoteRouteSession) {
            setMemo(remoteRouteSession.memo);
            setGeneratedMemo(memoWithLineTotals(remoteRouteSession.memo));
            setIsMemoComposerCollapsed(true);
            setPaidNicknames(new Set(remoteRouteSession.paidNicknames));
            setActiveSessionId(remoteRouteSession.id);
          }
        }

        if (remoteSessions.length > 0) {
          setSavedSessions((current) => {
            const merged = new Map<string, SavedSession>();

            [...current, ...remoteSessions].forEach((session) => {
              const existing = merged.get(session.id);

              if (!existing || new Date(session.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
                merged.set(session.id, session);
              }
            });

            const mergedSessions = sortSavedSessions(Array.from(merged.values()));
            window.localStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, JSON.stringify(mergedSessions));
            return mergedSessions;
          });
        }
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

        const paidList = Array.from(paidNicknames);

        if (existing.memo === memo && haveSameNicknames(existing.paidNicknames, paidList)) {
          return current;
        }

        nextSession = {
          ...existing,
          memo,
          paidNicknames: paidList,
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

      if (state?.unclozetView === "list" || state?.unclozetView === "memo" || state?.unclozetView === "orders") {
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
  const deleteOrderTarget = shippingRounds.find((round) => round.id === deleteTargetId);

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
    const isOrderTarget = id.startsWith("standalone-orders-");

    if (isOrderTarget) {
      const nextRounds = shippingRounds.filter((round) => round.id !== id);
      setShippingRounds(nextRounds);
      writeShippingRounds(nextRounds);
      deleteRemoteShippingRound(id).catch(() => undefined);
    } else {
      setSavedSessions((current) => current.filter((session) => session.id !== id));
      deleteRemoteSession(id).catch(() => undefined);
    }

    setSwipedSessionId(null);
    setSwipeState(null);
    setDeleteTargetId(null);

    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMemo("");
      setGeneratedMemo("");
      setPaidNicknames(new Set());
      setDraftTitle(defaultSessionTitle());
      if (isOrderTarget) {
        navigateToView("list");
      }
    }
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
    setIsMemoComposerCollapsed(true);
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
    setIsMemoComposerCollapsed(false);
    setPaidNicknames(new Set());
    setActiveSessionId(null);
    setDraftTitle(defaultSessionTitle());
    setShippingTab("waiting");
    setQuery("");
    navigateToView("memo", null);
    requestAnimationFrame(focusTextareaEnd);
  };

  const startNewOrder = () => {
    const orderId = `standalone-orders-${crypto.randomUUID()}`;
    setActiveSessionId(orderId);
    setShippingTab("waiting");
    setQuery("");
    setIsSearchOpen(false);
    navigateToView("orders", orderId);
  };

  const loadOrderRound = (round: ShippingRound) => {
    setActiveSessionId(round.id);
    setShippingTab("ready");
    setQuery("");
    setIsSearchOpen(false);
    navigateToView("orders", round.id);
  };

  const handleGenerateMemoWithTotals = () => {
    setGeneratedMemo(memoWithLineTotals(memo));
    setIsMemoComposerCollapsed(false);
  };

  const handleCopyGeneratedMemo = () => {
    if (!generatedMemo) {
      return;
    }

    navigator.clipboard?.writeText(generatedMemo).catch(() => undefined);
    setIsMemoComposerCollapsed(true);
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
              {viewMode === "list" ? "저장 리스트" : viewMode === "orders" ? "주문서 작업" : pageTitle}
            </h1>
            {viewMode !== "orders" ? (
              <p className="mt-1 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
                {viewMode === "list"
                  ? `${hasSupabase ? "Supabase 연결됨" : "이 브라우저에 저장 중"}`
                  : activeSession
                    ? "자동 저장 중"
                    : "저장 전 임시 저장 중"}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === "memo" ? (
              <button
                type="button"
                onClick={toggleSearch}
                aria-expanded={isSearchOpen}
                aria-label="검색"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1] md:px-4"
              >
                <HeaderIcon type="search" />
                <span className="hidden md:inline">검색</span>
              </button>
            ) : null}
            {viewMode === "memo" || viewMode === "orders" ? (
              <button
                type="button"
                onClick={() => navigateToView("list")}
                aria-label="리스트"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1] md:px-4"
              >
                <HeaderIcon type="list" />
                <span className="hidden md:inline">리스트</span>
              </button>
            ) : null}
            {viewMode === "memo" ? (
              <button
                type="button"
                onClick={saveCurrentSession}
                disabled={!memo.trim()}
                aria-label="저장"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-[#6366F1] px-3 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5] hover:shadow-[0_4px_12px_rgba(99,102,241,0.35)] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C] disabled:shadow-none md:px-4"
              >
                <HeaderIcon type="save" />
                <span className="hidden md:inline">저장</span>
              </button>
            ) : viewMode === "list" ? (
              <>
                {isStandaloneOrdersVisible ? (
                  <button
                    type="button"
                    onClick={startNewOrder}
                    className="h-10 rounded-md border border-[#E8E8EC] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#0A0A0A] transition hover:-translate-y-px hover:border-[#6366F1] hover:text-[#6366F1]"
                  >
                    주문서 작업
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={startNewMemo}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[#6366F1] px-4 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5]"
                >
                  <span aria-hidden="true" className="text-[19px] leading-none">+</span>
                  새 메모
                </button>
              </>
            ) : null}
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-['General_Sans'] text-[18px] font-bold text-[#0A0A0A]">메모</h2>
            <span className="rounded-full bg-[#F1F1F4] px-3 py-1 font-['DM_Sans'] text-[12px] font-bold text-[#71717A]">
              {savedSessions.length}건
            </span>
          </div>
          {savedSessions.length > 0 ? (
            savedSessions.map((session) => {
              const sessionSummaries = parseMemo(session.memo);
              const sessionParticipantIds = new Set(
                sessionSummaries.map((summary) => canonicalInstagramId(summary.nickname)),
              );
              const sessionRound = shippingRounds.find((round) => round.id === `memo-${session.id}`);
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
              저장된 메모가 없습니다.
            </div>
          )}

          {isStandaloneOrdersVisible ? (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <h2 className="font-['General_Sans'] text-[18px] font-bold text-[#0A0A0A]">주문서</h2>
                <span className="rounded-full bg-[#EEF2FF] px-3 py-1 font-['DM_Sans'] text-[12px] font-bold text-[#4F46E5]">
                  {standaloneOrderRounds.length}건
                </span>
              </div>
              {standaloneOrderRounds.length > 0 ? (
            standaloneOrderRounds.map((round) => {
              const readyCount = round.participants.filter((participant) => participant.status === "READY").length;
              const waitingCount = round.participants.filter((participant) => participant.status === "WAITING").length;
              const completedCount = round.participants.filter((participant) => participant.status === "COMPLETED").length;

              return (
                <div key={round.id} className="relative overflow-hidden rounded-xl bg-[#EF4444]">
                  <button
                    type="button"
                    onClick={() => requestDeleteSession(round.id)}
                    className="absolute inset-y-0 right-0 w-28 font-['DM_Sans'] text-[14px] font-bold text-white"
                  >
                    삭제
                  </button>
                  <article className="relative rounded-xl border border-[#E8E8EC] bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-['General_Sans'] text-[22px] font-bold leading-tight text-[#0A0A0A]">
                          주문서 작업 {new Date(round.createdAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </h3>
                        <span className="rounded-full bg-[#EEF2FF] px-2.5 py-1 font-['DM_Sans'] text-[11px] font-bold text-[#4F46E5]">주문서</span>
                      </div>
                      <p className="mt-2 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
                        총 {round.participants.length}건 · 출력 대기 {readyCount}건 · 확인 필요 {waitingCount}건 · 완료 {completedCount}건
                      </p>
                      <p className="mt-1 font-['JetBrains_Mono'] text-[12px] text-[#9C9C9C]">
                        저장 {new Date(round.updatedAt).toLocaleString("ko-KR")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => requestDeleteSession(round.id)}
                        className="h-11 rounded-md border border-[#FCA5A5] bg-white px-4 font-['DM_Sans'] text-[14px] font-medium text-[#DC2626] transition hover:-translate-y-px hover:bg-[#FEF2F2]"
                      >
                        삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => loadOrderRound(round)}
                        className="h-11 rounded-md bg-[#111827] px-5 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-black"
                      >
                        열기
                      </button>
                    </div>
                  </div>
                  </article>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-[#E8E8EC] bg-white p-8 text-center font-['DM_Sans'] text-[14px] font-medium text-[#9C9C9C]">
              저장된 주문서가 없습니다.
            </div>
              )}
            </>
          ) : null}
        </section>
      ) : viewMode === "orders" && isStandaloneOrdersVisible ? (
        <section className="mx-auto grid max-w-7xl gap-5 px-3 pt-5 md:px-6 md:pt-8">
          <ShippingWorkspace
            dateId={activeSessionId?.startsWith("standalone-orders-") ? activeSessionId : `standalone-orders-${localDateId()}`}
            summaries={EMPTY_SHIPPING_SUMMARIES}
            tab={shippingTab}
            onTabChange={setShippingTab}
            onCountsChange={handleShippingCountsChange}
            standalone
          />
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

          {generatedMemo && isMemoComposerCollapsed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E8EC] bg-white p-3 md:p-4">
              <div className="min-w-0">
                <p className="font-['DM_Sans'] text-[13px] font-bold text-[#52525B]">메모 입력 접힘</p>
                <p className="mt-1 truncate font-['JetBrains_Mono'] text-[12px] text-[#9C9C9C]">
                  {summaries.length}명 · {numberWithComma(grandQuantity)}개 · {won(grandTotal)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsMemoComposerCollapsed(false)}
                  className="h-9 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[13px] font-medium text-[#0A0A0A] transition hover:border-[#6366F1] hover:text-[#6366F1]"
                >
                  펼치기
                </button>
                <button
                  type="button"
                  onClick={handleCopyGeneratedMemo}
                  className="h-9 rounded-md bg-[#111827] px-3 font-['DM_Sans'] text-[13px] font-medium text-white transition hover:bg-black"
                >
                  복사
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`grid gap-3 rounded-xl border border-[#E8E8EC] bg-white p-3 md:p-4 ${
                generatedMemo ? "md:grid-cols-2 md:gap-4" : ""
              }`}
            >
              <div className="grid min-w-0 grid-rows-[1fr_auto] gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">메모 입력</p>
                  {generatedMemo ? (
                    <button
                      type="button"
                      onClick={() => setIsMemoComposerCollapsed(true)}
                      className="h-8 rounded-md border border-[#E8E8EC] bg-white px-3 font-['DM_Sans'] text-[12px] font-medium text-[#6B6B6B] transition hover:border-[#6366F1] hover:text-[#6366F1]"
                    >
                      접기
                    </button>
                  ) : null}
                </div>
                <textarea
                  ref={textareaRef}
                  value={memo}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMemo(event.target.value)}
                  className={`${generatedMemo ? "min-h-24 md:min-h-32" : "min-h-40 md:min-h-48"} w-full resize-y rounded-lg border border-[#E8E8EC] bg-white p-4 font-['JetBrains_Mono'] text-[16px] leading-7 text-[#0A0A0A] outline-none transition placeholder:text-[#9C9C9C] focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15 md:text-[17px]`}
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
                    className="min-h-24 h-full w-full resize-y rounded-lg border border-[#E8E8EC] bg-[#FAFAFA] p-4 font-['JetBrains_Mono'] text-[15px] leading-7 text-[#0A0A0A] outline-none md:min-h-32"
                  />
                </div>
              ) : null}
            </div>
          )}

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

      {deleteTarget || deleteOrderTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl border border-[#E8E8EC] bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
            <h2 className="font-['General_Sans'] text-[22px] font-bold leading-tight text-[#0A0A0A]">리스트 삭제</h2>
            <p className="mt-2 font-['DM_Sans'] text-[14px] font-medium leading-6 text-[#6B6B6B]">
              {deleteTarget ? `${deleteTarget.title} 리스트를 삭제할까요?` : "주문서 작업을 삭제할까요?"}
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

"use client";

import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type PurchaseItem = {
  clothingNo?: string;
  rawPrice: string;
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
};

type SortMode = "memo" | "name" | "amountAsc" | "amountDesc";

const MEMO_STORAGE_KEY = "unclozet-live-memo";
const PAID_STORAGE_KEY = "unclozet-live-paid-nicknames";

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

function parseMemo(text: string): BuyerSummary[] {
  const summaries = new Map<string, BuyerSummary>();

  text.split("\n").forEach((line) => {
    const [nicknamePart, ...contentParts] = line.split(":");
    const nickname = nicknamePart?.trim();
    const content = contentParts.join(":").trim();

    if (!nickname || !content) {
      return;
    }

    const numberedMatches = Array.from(content.matchAll(/(\d+)\s*번\s*([0-9]+(?:[.,][0-9]+)?)/g));
    const priceEntries: PriceEntry[] =
      numberedMatches.length > 0
        ? numberedMatches.map((match) => ({
            clothingNo: match[1],
            rawPrice: match[2].replace(",", "."),
          }))
        : Array.from(content.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)).map((match) => ({
            rawPrice: match[0].replace(",", "."),
          }));

    if (priceEntries.length === 0) {
      return;
    }

    const previous = summaries.get(nickname) ?? {
      nickname,
      quantity: 0,
      total: 0,
      items: [],
    };

    priceEntries.forEach((entry) => {
      const price = normalizePrice(entry.rawPrice);
      const item = {
        clothingNo: entry.clothingNo,
        rawPrice: entry.rawPrice,
        price,
      };

      previous.items.push(item);
      previous.quantity += 1;
      previous.total += price;
    });

    summaries.set(nickname, previous);
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
  return item.clothingNo ? `${item.clothingNo}번 ${won(item.price)}` : won(item.price);
}

function escapeCsvCell(value: string | number) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default function Home() {
  const [memo, setMemo] = useState("");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("memo");
  const [paidNicknames, setPaidNicknames] = useState<Set<string>>(new Set());
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [activeMemoMatchIndex, setActiveMemoMatchIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const filteredSummaries = useMemo(() => {
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
  const paidCount = summaries.filter((summary) => paidNicknames.has(summary.nickname)).length;

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

  useEffect(() => {
    setActiveMemoMatchIndex(-1);
  }, [query]);

  useEffect(() => {
    const savedMemo = window.localStorage.getItem(MEMO_STORAGE_KEY);
    const savedPaidNicknames = window.localStorage.getItem(PAID_STORAGE_KEY);

    if (savedMemo) {
      setMemo(savedMemo);
    }

    if (savedPaidNicknames) {
      try {
        const parsed = JSON.parse(savedPaidNicknames);

        if (Array.isArray(parsed)) {
          setPaidNicknames(new Set(parsed.filter((value) => typeof value === "string")));
        }
      } catch {
        setPaidNicknames(new Set());
      }
    }

    setHasLoadedStorage(true);
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
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const shouldFocusSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";

      if (shouldFocusSearch) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const focusTextareaEnd = () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
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

  const togglePaid = (nickname: string) => {
    setPaidNicknames((current) => {
      const next = new Set(current);

      if (next.has(nickname)) {
        next.delete(nickname);
      } else {
        next.add(nickname);
      }

      return next;
    });
  };

  const handleDownloadCsv = () => {
    const header = ["닉네임", "총수량", "총금액", "입금여부", "상세내역"];
    const rows = summaries.map((summary) => [
      summary.nickname,
      summary.quantity,
      summary.total,
      paidNicknames.has(summary.nickname) ? "입금완료" : "미입금",
      summary.items.map(itemLabel).join(" + "),
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `live-commerce-summary-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-dvh bg-[#FAFAFA] pb-8 text-[#0A0A0A]">
      <div className="sticky top-0 z-20 border-b border-[#E8E8EC] bg-white/90 px-3 py-3 backdrop-blur md:px-6">
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
            메모 {memoMatches.length}건 · 카드 {filteredSummaries.length}명 · 입금 {paidCount}명
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

      <section className="mx-auto grid max-w-7xl gap-5 px-3 pt-5 md:px-6 md:pt-8">
        <div className="grid grid-cols-3 gap-3 md:gap-5">
          <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
            <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">고객</p>
            <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#0A0A0A] md:text-[32px]">{summaries.length}명</p>
          </div>
          <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
            <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">수량</p>
            <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#0A0A0A] md:text-[32px]">{grandQuantity}개</p>
          </div>
          <div className="rounded-lg border border-[#E8E8EC] bg-white px-4 py-3 md:px-5">
            <p className="font-['DM_Sans'] text-[12px] font-medium uppercase text-[#6B6B6B]">합계</p>
            <p className="mt-1 font-['General_Sans'] text-2xl font-bold leading-none text-[#6366F1] md:text-[32px]">{won(grandTotal)}</p>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={memo}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMemo(event.target.value)}
          className="min-h-[70dvh] w-full rounded-xl border border-[#E8E8EC] bg-white p-4 font-['JetBrains_Mono'] text-[17px] leading-8 text-[#0A0A0A] outline-none transition placeholder:text-[#9C9C9C] focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15 md:min-h-[74dvh] md:p-5 md:text-[19px]"
          placeholder="예: 홍길동: 1.5 + 2.3 + 0.8"
          spellCheck={false}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E8E8EC] bg-white px-4 py-3">
          <div>
            <p className="font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
              검색 결과 {filteredSummaries.length}명 / 전체 {summaries.length}명
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="sort">
              정렬
            </label>
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
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={summaries.length === 0}
              className="h-11 rounded-md bg-[#6366F1] px-6 font-['DM_Sans'] text-[14px] font-medium text-white transition hover:-translate-y-px hover:bg-[#4F46E5] hover:shadow-[0_4px_12px_rgba(99,102,241,0.35)] disabled:cursor-not-allowed disabled:bg-[#F5F5F5] disabled:text-[#9C9C9C] disabled:shadow-none"
            >
              엑셀 다운로드
            </button>
          </div>
        </div>

        <section className="grid gap-4">
          {filteredSummaries.length > 0 ? (
            filteredSummaries.map((summary) => (
              <article key={summary.nickname} className="rounded-xl border border-[#E8E8EC] bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      id={`paid-${encodeURIComponent(summary.nickname)}`}
                      type="checkbox"
                      checked={paidNicknames.has(summary.nickname)}
                      onChange={() => togglePaid(summary.nickname)}
                      className="mt-1 size-5 rounded border border-[#E8E8EC] accent-[#6366F1]"
                    />
                    <div>
                      <label htmlFor={`paid-${encodeURIComponent(summary.nickname)}`} className="font-['General_Sans'] text-[24px] font-bold leading-tight text-[#0A0A0A]">
                        {summary.nickname}
                      </label>
                      <p className="mt-1 font-['DM_Sans'] text-[13px] font-medium text-[#6B6B6B]">
                        총 {summary.quantity}개 · {won(summary.total)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#F4F4FF] px-3 py-2 text-right">
                    <p className="font-['DM_Sans'] text-[11px] font-medium uppercase text-[#6B6B6B]">
                      {paidNicknames.has(summary.nickname) ? "입금완료" : "미입금"}
                    </p>
                    <p className="font-['General_Sans'] text-lg font-bold leading-none text-[#6366F1]">{won(summary.total)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.items.map((item, index) => (
                    <span
                      key={`${summary.nickname}-${item.clothingNo}-${index}`}
                      className="rounded-full bg-[#F1F1F4] px-3 py-1 font-['JetBrains_Mono'] text-[12px] font-medium text-[#6B6B6B]"
                    >
                      {itemLabel(item)}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-[#E8E8EC] bg-white p-8 text-center font-['DM_Sans'] text-[14px] font-medium text-[#9C9C9C]">
              표시할 결과가 없습니다.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

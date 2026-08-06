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

  return Array.from(summaries.values()).sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"));
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
  const [activeMemoMatchIndex, setActiveMemoMatchIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const summaries = useMemo(() => parseMemo(memo), [memo]);
  const filteredSummaries = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return summaries;
    }

    return summaries.filter((summary) => {
      const nicknameMatched = summary.nickname.toLowerCase().includes(keyword);
      const itemMatched = summary.items.some((item) => {
        const itemNo = item.clothingNo ? `${item.clothingNo}번`.toLowerCase() : "";
        const priceText = `${item.rawPrice} ${item.price} ${won(item.price)}`.toLowerCase();
        return itemNo.includes(keyword) || priceText.includes(keyword);
      });

      return nicknameMatched || itemMatched;
    });
  }, [query, summaries]);

  const grandQuantity = summaries.reduce((sum, summary) => sum + summary.quantity, 0);
  const grandTotal = summaries.reduce((sum, summary) => sum + summary.total, 0);

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

  const handleDownloadCsv = () => {
    const header = ["닉네임", "총수량", "총금액", "상세내역"];
    const rows = summaries.map((summary) => [
      summary.nickname,
      summary.quantity,
      summary.total,
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
    <main className="min-h-dvh bg-white pb-8 text-black">
      <div className="sticky top-0 z-20 border-b-[5px] border-black bg-white px-3 py-3 md:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <label className="sr-only" htmlFor="search">
            검색
          </label>
          <input
            ref={searchRef}
            id="search"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-12 flex-1 rounded-none border-[3px] border-black bg-[#f0f0f0] px-3 font-mono text-[15px] text-black outline-none hover:bg-[#e8e8e8] focus:border-[5px]"
            placeholder="닉네임 또는 금액 검색"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setQuery("")}
            className="h-12 rounded-none border-[3px] border-black bg-white px-4 text-xs font-black uppercase tracking-[2px] text-black hover:bg-black hover:text-white active:border-[5px]"
          >
            지우기
          </button>
        </div>
        <div className="mx-auto mt-2 flex max-w-6xl items-center justify-between gap-2 font-mono text-[12px] text-black">
          <span className="border-[2px] border-black bg-white px-2 py-1 uppercase tracking-[1px]">
            메모 {memoMatches.length}건 · 카드 {filteredSummaries.length}명
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => moveMemoMatch(-1)}
              disabled={memoMatches.length === 0}
              className="h-9 rounded-none border-[3px] border-black bg-white px-3 text-xs font-black uppercase tracking-[2px] text-black hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-[#f5f5f5] disabled:text-[#777777]"
            >
              이전
            </button>
            <button
              type="button"
              onClick={() => moveMemoMatch(1)}
              disabled={memoMatches.length === 0}
              className="h-9 rounded-none border-[3px] border-black bg-white px-3 text-xs font-black uppercase tracking-[2px] text-black hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-[#f5f5f5] disabled:text-[#777777]"
            >
              다음
            </button>
          </div>
        </div>
      </div>

      <section className="mx-auto grid max-w-6xl gap-6 px-3 pt-6 md:px-6">
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <div className="rounded-none border-[3px] border-black bg-white px-3 py-3 md:px-5">
            <p className="font-['Archivo_Black'] text-[12px] uppercase tracking-[1px] text-black">고객</p>
            <p className="font-['Archivo_Black'] text-2xl leading-none text-black md:text-[32px]">{summaries.length}명</p>
          </div>
          <div className="rounded-none border-[3px] border-black bg-white px-3 py-3 md:px-5">
            <p className="font-['Archivo_Black'] text-[12px] uppercase tracking-[1px] text-black">수량</p>
            <p className="font-['Archivo_Black'] text-2xl leading-none text-black md:text-[32px]">{grandQuantity}개</p>
          </div>
          <div className="rounded-none border-[5px] border-black bg-black px-3 py-3 text-white md:px-5">
            <p className="font-['Archivo_Black'] text-[12px] uppercase tracking-[1px]">합계</p>
            <p className="font-['Archivo_Black'] text-2xl leading-none md:text-[32px]">{won(grandTotal)}</p>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={memo}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMemo(event.target.value)}
          className="min-h-[70dvh] w-full rounded-none border-[5px] border-black bg-[#f0f0f0] p-3 font-mono text-[18px] leading-8 text-black outline-none hover:bg-[#e8e8e8] focus:bg-white md:min-h-[74dvh] md:p-5 md:text-[20px]"
          placeholder="예: 홍길동: 1.5 + 2.3 + 0.8"
          spellCheck={false}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-y-[3px] border-black py-3">
          <div>
            <p className="font-mono text-[13px] font-bold uppercase tracking-[1px] text-black">
              검색 결과 {filteredSummaries.length}명 / 전체 {summaries.length}명
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={summaries.length === 0}
            className="h-12 rounded-none border-[3px] border-black bg-black px-6 text-sm font-black uppercase tracking-[2px] text-white hover:bg-white hover:text-black active:border-[5px] disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-[#f5f5f5] disabled:text-[#777777]"
          >
            엑셀 다운로드
          </button>
        </div>

        <section className="grid gap-4">
          {filteredSummaries.length > 0 ? (
            filteredSummaries.map((summary) => (
              <article key={summary.nickname} className="rounded-none border-[3px] border-black bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-['Archivo_Black'] text-[28px] leading-none text-black md:text-[32px]">{summary.nickname}</h2>
                    <p className="mt-2 font-mono text-[13px] font-bold uppercase tracking-[1px] text-black">
                      총 {summary.quantity}개 · {won(summary.total)}
                    </p>
                  </div>
                  <div className="rounded-none border-[3px] border-black bg-black px-3 py-2 text-right text-white">
                    <p className="font-['Archivo_Black'] text-[11px] uppercase tracking-[1px]">총액</p>
                    <p className="font-['Archivo_Black'] text-lg leading-none">{won(summary.total)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.items.map((item, index) => (
                    <span
                      key={`${summary.nickname}-${item.clothingNo}-${index}`}
                      className="rounded-none border-[2px] border-black bg-white px-3 py-1 font-mono text-[13px] font-bold"
                    >
                      {itemLabel(item)}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-none border-[3px] border-dashed border-black bg-white p-6 text-center font-mono text-[13px] font-bold uppercase tracking-[1px] text-black">
              표시할 결과가 없습니다.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

// Existing V1 settlement parsing retained; V2 diagnostics are layered below.
export type PurchaseItem = {
  clothingNo?: string;
  rawPrice: string;
  quantity: number;
  price: number;
};

export type BuyerSummary = {
  nickname: string;
  quantity: number;
  total: number;
  items: PurchaseItem[];
};

export type PriceEntry = {
  clothingNo?: string;
  rawPrice: string;
  quantity: number;
};

export function normalizePrice(value: string) {
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

export function parseMemoLine(line: string) {
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

export function parseMemo(text: string): BuyerSummary[] {
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

export function won(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function itemLabel(item: PurchaseItem) {
  const priceLabel = item.clothingNo ? `${item.clothingNo}번 ${won(item.price)}` : won(item.price);

  return item.quantity > 1 ? `${priceLabel} x ${item.quantity}` : priceLabel;
}

function numberWithComma(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function memoWithLineTotals(text: string) {
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

// Keep the proven parser above intact. Only normalize generated totals and
// thousands separators before parsing, and report text that it cannot consume.
export function settlementInputLine(line: string) {
  return line.replace(/\s*=\s*[\d,]+\s*$/, "").replace(/\b\d{1,3}(?:,\d{3})+\b/g, (n) => n.replaceAll(",", ""));
}

export function analyzeSettlement(text: string) {
  const errors: Array<{ line: number; text: string; message: string }> = [];
  const accepted: string[] = [];
  text.split(/\r?\n/).forEach((original, index) => {
    if (!original.trim()) return;
    const line = settlementInputLine(original);
    const parsed = parseMemoLine(line);
    const content = line.match(/^\s*.*?\s*[:\-–—]\s*(.+?)\s*$/)?.[1] ?? "";
    const tokenPattern = /(?:\d+\s*번\s*)?[0-9]+(?:[.,][0-9]+)?(?:\s*[*xX×]\s*\d+)?/g;
    const residue = content.replace(tokenPattern, "").replace(/[\s+\/원]/g, "");
    const mixedNumbering = /\d+\s*번/.test(content) && content.replace(/\d+\s*번\s*[0-9]+(?:[.,][0-9]+)?(?:\s*[*xX×]\s*\d+)?/g, "").replace(/[\s+\/원]/g, "") !== "";
    if (!parsed || residue || mixedNumbering || /[*xX×]\s*0(?:\D|$)/.test(content) || parsed.total <= 0) {
      errors.push({ line: index + 1, text: original, message: "아이디 - 금액 형식을 확인하세요. 인식하지 못한 항목이 있습니다." });
    } else {
      accepted.push(line);
    }
  });
  const byId = new Map<string, BuyerSummary>();
  for (const buyer of parseMemo(accepted.join("\n"))) {
    const key = buyer.nickname.trim().replace(/^@/, "").toLowerCase();
    const previous = byId.get(key);
    byId.set(key, previous ? { ...previous, quantity: previous.quantity + buyer.quantity, total: previous.total + buyer.total, items: [...previous.items, ...buyer.items] } : buyer);
  }
  return { buyers: [...byId.values()], errors, announcement: memoWithLineTotals(accepted.join("\n")) };
}

export type ShippingStatus = "WAITING" | "READY" | "COMPLETED";

export type ShippingInfo = {
  name: string;
  address: string;
  zipCode: string;
  phone1: string;
  phone2: string;
  memo: string;
  items: string;
};

export type ShippingParticipant = {
  instagramId: string;
  status: ShippingStatus;
  shippingInfo: ShippingInfo | null;
};

export type ShippingRound = {
  id: string;
  participants: ShippingParticipant[];
  createdAt: string;
  updatedAt: string;
};

export type ParsedKakaoOrder = {
  instagramId: string;
  shippingInfo: ShippingInfo;
};

const SHIPPING_ROUNDS_KEY = "unclozet-shipping-rounds-v1";

export const MAX_PARTICIPANTS = 1000;

export function emptyShippingInfo(): ShippingInfo {
  return {
    name: "",
    address: "",
    zipCode: "",
    phone1: "",
    phone2: "",
    memo: "",
    items: "",
  };
}

export function canonicalInstagramId(value: string) {
  return value.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
}

function isShippingInfo(value: unknown): value is ShippingInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const info = value as Record<string, unknown>;
  return ["name", "address", "zipCode", "phone1", "phone2", "memo", "items"].every(
    (key) => typeof info[key] === "string",
  );
}

function isShippingParticipant(value: unknown): value is ShippingParticipant {
  if (!value || typeof value !== "object") {
    return false;
  }

  const participant = value as Record<string, unknown>;
  return (
    typeof participant.instagramId === "string" &&
    ["WAITING", "READY", "COMPLETED"].includes(String(participant.status)) &&
    (participant.shippingInfo === null || isShippingInfo(participant.shippingInfo))
  );
}

export function readShippingRounds(): ShippingRound[] {
  try {
    const raw = window.localStorage.getItem(SHIPPING_ROUNDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((round): round is ShippingRound => {
      if (!round || typeof round !== "object") {
        return false;
      }

      const candidate = round as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        Array.isArray(candidate.participants) &&
        candidate.participants.every(isShippingParticipant) &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.updatedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function writeShippingRounds(rounds: ShippingRound[]) {
  window.localStorage.setItem(SHIPPING_ROUNDS_KEY, JSON.stringify(rounds));
}

export function seedShippingRound(dateId: string, instagramIds: string[]) {
  const now = new Date().toISOString();
  const rounds = readShippingRounds();
  const existing = rounds.find((round) => round.id === dateId);
  const uniqueIds = instagramIds
    .map((id) => id.trim())
    .filter(Boolean)
    .filter((id, index, all) => all.findIndex((value) => canonicalInstagramId(value) === canonicalInstagramId(id)) === index)
    .slice(0, MAX_PARTICIPANTS);

  if (existing) {
    const currentById = new Map(
      existing.participants.map((participant) => [canonicalInstagramId(participant.instagramId), participant]),
    );
    const added = uniqueIds
      .filter((id) => !currentById.has(canonicalInstagramId(id)))
      .map((instagramId): ShippingParticipant => ({ instagramId, status: "WAITING", shippingInfo: null }));
    const nextRound = { ...existing, participants: [...existing.participants, ...added], updatedAt: now };
    writeShippingRounds(rounds.map((round) => (round.id === dateId ? nextRound : round)));
    return nextRound;
  }

  const nextRound: ShippingRound = {
    id: dateId,
    participants: uniqueIds.map((instagramId) => ({ instagramId, status: "WAITING", shippingInfo: null })),
    createdAt: now,
    updatedAt: now,
  };
  writeShippingRounds([nextRound, ...rounds]);
  return nextRound;
}

export function saveShippingRound(round: ShippingRound) {
  const rounds = readShippingRounds();
  const nextRound = { ...round, updatedAt: new Date().toISOString() };
  const exists = rounds.some((candidate) => candidate.id === round.id);
  writeShippingRounds(exists ? rounds.map((candidate) => (candidate.id === round.id ? nextRound : candidate)) : [nextRound, ...rounds]);
  return nextRound;
}

function cleanValue(value: string) {
  return value.replace(/^[\s:：=\-–—•·*]+/, "").trim();
}

function valueForLabels(lines: string[], labels: string[]) {
  const pattern = new RegExp(
    `^(?:[-–—•·*]|\\d+[.)])?\\s*(?:${labels.join("|")})\\s*[:：=\\-–—]?\\s*(.*)$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);

    if (!match) {
      continue;
    }

    const inlineValue = cleanValue(match[1] ?? "");
    if (inlineValue) {
      return inlineValue;
    }

    const nextLine = lines[index + 1];
    if (nextLine) {
      return cleanValue(nextLine);
    }
  }

  return "";
}

function findParticipantId(text: string, lines: string[], participantIds: string[]) {
  const labeledId = valueForLabels(lines, ["인스타그램(?:\\s*아이디)?", "인스타(?:\\s*아이디)?", "instagram(?:\\s*id)?", "아이디", "id"]);
  const candidates = [labeledId, lines[0] ?? "", ...lines];

  if (participantIds.length === 0) {
    for (const candidate of candidates) {
      const cleanedCandidate = cleanValue(candidate).split(/\s+/)[0];

      if (/^@?[a-z0-9._]{2,30}$/i.test(cleanedCandidate)) {
        return cleanedCandidate;
      }
    }
  }

  for (const candidate of candidates) {
    const cleanedCandidate = cleanValue(candidate).split(/\s+/)[0];
    const canonicalCandidate = canonicalInstagramId(cleanedCandidate);
    const matched = participantIds.find((id) => canonicalInstagramId(id) === canonicalCandidate);

    if (matched) {
      return matched;
    }
  }

  const lowerText = text.toLowerCase();
  return (
    participantIds.find((id) => {
      const canonical = canonicalInstagramId(id);
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9._])@?${escaped}(?=$|[^a-z0-9._])`, "i").test(lowerText);
    }) ?? ""
  );
}

export function parseKakaoOrder(text: string, participantIds: string[]): ParsedKakaoOrder {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const instagramId = findParticipantId(text, lines, participantIds);
  const phoneMatches = text.match(/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/g) ?? [];
  const zipMatch = text.match(/(?:우편번호\s*[:：=\-–—]?\s*)?(\d{5})(?!\d)/);
  let parsedName = valueForLabels(lines, [
    "받으실\\s*분(?:의)?\\s*성함",
    "받는\\s*분(?:\\s*성명)?",
    "받는분(?:\\s*성명)?",
    "수령인",
    "성함",
    "이름",
  ]);
  let parsedAddress = valueForLabels(lines, [
    "받으실\\s*분(?:의)?\\s*주소",
    "받는\\s*분\\s*주소",
    "받는분\\s*주소",
    "배송지",
    "주소",
  ]);
  const parsedPhone1 = valueForLabels(lines, ["전화번호", "연락처", "휴대폰", "핸드폰"]);
  const parsedPhone2 = valueForLabels(lines, ["기타\\s*연락처", "비상\\s*연락처"]);
  const parsedZipCode = valueForLabels(lines, ["우편번호"]) || zipMatch?.[1] || "";

  if ((!parsedName || !parsedAddress) && instagramId) {
    const idLineIndex = lines.findIndex((line) => {
      const firstToken = cleanValue(line).split(/\s+/)[0];
      return canonicalInstagramId(firstToken) === canonicalInstagramId(instagramId);
    });
    const detailLines = idLineIndex >= 0 ? lines.slice(idLineIndex + 1) : lines;
    const phoneLineIndex = detailLines.findIndex((line) => /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(line));

    if (!parsedName && detailLines[0] && !/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(detailLines[0])) {
      parsedName = cleanValue(detailLines[0]);
    }

    if (!parsedAddress) {
      const addressLines = detailLines.slice(1, phoneLineIndex >= 0 ? phoneLineIndex : undefined);
      parsedAddress = addressLines.map(cleanValue).filter(Boolean).join(" ");
    }
  }

  return {
    instagramId,
    shippingInfo: {
      name: parsedName,
      address: parsedAddress,
      zipCode: parsedZipCode,
      phone1: parsedPhone1 || phoneMatches[0] || "",
      phone2: parsedPhone2 || phoneMatches[1] || "",
      memo: valueForLabels(lines, ["배송\\s*메세지", "배송\\s*메시지", "요청사항", "메모"]),
      items: valueForLabels(lines, ["품목명", "품목", "상품명", "상품", "주문\\s*내역"]),
    },
  };
}

export function isReadyShippingInfo(info: ShippingInfo) {
  return Boolean(
    info.name.trim() &&
      info.address.trim() &&
      info.phone1.trim() &&
      info.items.trim(),
  );
}

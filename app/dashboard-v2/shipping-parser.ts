// Pure parser extracted from V1. No storage or network dependencies.
export type ShippingInfo = {
  name: string;
  address: string;
  zipCode: string;
  phone1: string;
  phone2: string;
  memo: string;
  items: string;
};

export type ParsedKakaoOrder = {
  instagramId: string;
  shippingInfo: ShippingInfo;
};

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

function cleanValue(value: string) {
  return value.replace(/^[\s:：=\-–—•·*]+/, "").trim();
}

function removeLooseSpaces(value: string) {
  return value.replace(/\s+/g, "");
}

function compactKoreanAddress(value: string) {
  const normalized = value
    .replace(/\s*([,()])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/[\s:：=\-–—•·*]+$/g, "")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  const singleCharacterTokens = tokens.filter((token) => /^[가-힣0-9]$/.test(token)).length;
  const looksArtificiallySpaced = tokens.length >= 8 && singleCharacterTokens / tokens.length > 0.65;

  if (!looksArtificiallySpaced) {
    return normalized;
  }

  return normalized
    .replace(/\s+/g, "")
    .replace(/(특별자치도|특별시|광역시|자치도|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주도|서울시|부산시|대구시|인천시|광주시|대전시|울산시|세종시|[가-힣]+시|[가-힣]+군|[가-힣]+구|[가-힣]+읍|[가-힣]+면|[가-힣]+동|[가-힣]+로|[가-힣]+길)/g, "$1 ")
    .replace(/(\d+)(동|호)/g, "$1$2 ")
    .replace(/\s*([,()])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/[\s:：=\-–—•·*]+$/g, "")
    .trim();
}

function stripFieldNoise(value: string) {
  return cleanValue(value)
    .replace(/(?:인스타그램?\s*아이디|인스타|instagram\s*id|아이디|id|성함|이름|주소|전화번호|연락처|휴대폰|핸드폰)\s*[:：=]*/gi, " ")
    .trim();
}

function phoneCandidate(value: string) {
  const domesticMobileMatch = value.match(/(?<!\d)0[\s.-]*1[\s.-]*0(?:[\s.-]*\d){8}(?!\d)/);

  if (domesticMobileMatch) {
    return domesticMobileMatch[0];
  }

  const internationalMobileMatch = value.match(/(?<!\d)\+?\s*8\s*2[\s.-]*1[\s.-]*0(?:[\s.-]*\d){8}(?!\d)/);

  if (internationalMobileMatch) {
    return internationalMobileMatch[0];
  }

  const bareMobileMatch = value.match(/(?<!\d)1[\s.-]*0(?:[\s.-]*\d){8}(?!\d)/);

  if (bareMobileMatch) {
    return bareMobileMatch[0];
  }

  const looseNumberMatch = value.match(/(?:^|[^\d])((?:\d[\s.-]*){8,11})(?=$|[^\d])/);
  return looseNumberMatch?.[1] ?? "";
}

function firstInstagramId(value: string) {
  // Keep numeric-only address/phone fragments out of the fallback, while
  // accepting digit/underscore-leading IDs containing a letter.
  return stripFieldNoise(value).match(/(?<![a-z0-9._])@?(?=[a-z0-9._]{0,29}[a-z])[a-z0-9._]{2,30}(?![a-z0-9._])/i)?.[0] ?? "";
}

function firstKoreanName(value: string) {
  const candidates = Array.from(stripFieldNoise(value).matchAll(/(?:^|[^가-힣])((?:[가-힣]\s*){2,6})(?=$|[^가-힣])/g))
    .map((match) => removeLooseSpaces(match[1]))
    .filter((candidate) => /^[가-힣]{2,6}$/.test(candidate));

  return candidates.find((candidate) => !/(?:특별|광역|자치|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|시|도|구|군|동|읍|면|로|길|리)$/.test(candidate)) ?? "";
}

function firstStandaloneKoreanName(value: string) {
  const addressPart = addressStartIndex(value);
  const nameArea = addressPart >= 0 ? value.slice(0, addressPart) : value;
  const candidates = Array.from(nameArea.matchAll(/(?:^|[\s,()/])([가-힣]{2,10})(?=$|[\s,()/])/g))
    .map((match) => match[1]);

  return candidates.find((candidate) => !/(?:특별|광역|자치|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|시|도)?$/.test(candidate)) ?? "";
}

function addressStartIndex(value: string) {
  const compact = removeLooseSpaces(value);
  const markers = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  ];
  const compactIndex = markers
    .map((marker) => compact.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (compactIndex === undefined) {
    return -1;
  }

  let compactCursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\s/.test(value[index])) {
      continue;
    }

    if (compactCursor === compactIndex) {
      return index;
    }

    compactCursor += 1;
  }

  return -1;
}

function firstAddress(value: string) {
  const withoutPhone = value.replace(phoneCandidate(value), " ");
  const withoutId = withoutPhone.replace(firstInstagramId(withoutPhone), " ");
  const start = addressStartIndex(withoutId);

  if (start < 0) {
    return "";
  }

  return compactKoreanAddress(cleanValue(withoutId.slice(start)));
}

export function normalizePhoneNumber(value: string) {
  let digits = value.replace(/\D/g, "");

  if (digits.startsWith("82")) {
    digits = `0${digits.slice(2)}`;
  }

  if (digits.startsWith("10") && digits.length === 10) {
    digits = `0${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  // Never invent a mobile prefix for an invalid number. V2 validation will
  // surface the original value instead of turning it into a plausible phone.
  return value.trim();
}

function looksLikeInstagramId(value: string) {
  return Boolean(firstInstagramId(value));
}

function looksLikeKoreanName(value: string) {
  return Boolean(firstKoreanName(value));
}

function looksLikePhone(value: string) {
  return Boolean(phoneCandidate(value));
}

function looksLikeAddress(value: string) {
  return Boolean(firstAddress(value));
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
      // A free-form order often starts with an ID followed by a comma or a
      // Korean name. Extract the English-containing token itself instead of
      // requiring the complete first token to be punctuation-free.
      const foundId = firstInstagramId(candidate);

      if (foundId) {
        return foundId;
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
  const fullText = lines.join(" / ");
  const segments = text
    .split(/\r?\n|\s+\/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const phoneMatches = [...segments, fullText].map(phoneCandidate).filter(Boolean);
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
  let parsedInstagramId = instagramId;

  for (const line of lines) {
    const value = cleanValue(line);
    const phone = phoneCandidate(value);
    const withoutPhone = cleanValue(value.replace(phone, " "));

    if (!parsedInstagramId && looksLikeInstagramId(withoutPhone)) {
      parsedInstagramId = firstInstagramId(withoutPhone);
    }

    if (!parsedName) {
      const withoutId = cleanValue(withoutPhone.replace(parsedInstagramId || firstInstagramId(withoutPhone), " "));
      parsedName = firstStandaloneKoreanName(withoutId) || (looksLikeKoreanName(withoutId) ? firstKoreanName(withoutId) : "");
    }

    if (!parsedAddress && looksLikeAddress(value)) {
      parsedAddress = firstAddress(value);
    }
  }

  parsedInstagramId = parsedInstagramId || firstInstagramId(fullText);
  parsedName = parsedName || firstKoreanName(fullText);
  parsedAddress = parsedAddress || firstAddress(fullText);

  if ((!parsedName || !parsedAddress) && parsedInstagramId) {
    const idLineIndex = lines.findIndex((line) => {
      const firstToken = cleanValue(line).split(/\s+/)[0];
      return canonicalInstagramId(firstToken) === canonicalInstagramId(parsedInstagramId);
    });
    const detailLines = idLineIndex >= 0 ? lines.slice(idLineIndex + 1) : lines;
    const phoneLineIndex = detailLines.findIndex((line) => looksLikePhone(line));

    if (!parsedName && detailLines[0] && !looksLikePhone(detailLines[0])) {
      parsedName = firstKoreanName(detailLines[0]) || cleanValue(detailLines[0]);
    }

    if (!parsedAddress) {
      const addressLines = detailLines.slice(1, phoneLineIndex >= 0 ? phoneLineIndex : undefined);
      parsedAddress = firstAddress(addressLines.join(" ")) || addressLines.map(cleanValue).filter(Boolean).join(" ");
    }
  }

  const normalizedPhone1 = normalizePhoneNumber(parsedPhone1 || phoneCandidate(fullText) || phoneMatches[0] || "");
  const normalizedPhone2 = normalizePhoneNumber(parsedPhone2 || "") || normalizedPhone1;

  return {
    instagramId: parsedInstagramId,
    shippingInfo: {
      name: parsedName,
      address: parsedAddress,
      zipCode: "",
      phone1: normalizedPhone1,
      phone2: normalizedPhone2,
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

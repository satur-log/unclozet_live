"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalInstagramId,
  emptyShippingInfo,
  isReadyShippingInfo,
  normalizePhoneNumber,
  parseKakaoOrder,
  readShippingRounds,
  saveRemoteShippingRound,
  saveShippingRound,
  seedShippingRound,
  ShippingInfo,
  ShippingParticipant,
  ShippingRound,
} from "./shipping-data";

export type ShippingTab = "waiting" | "ready" | "completed";
export type ShippingCounts = { waiting: number; ready: number; completed: number };
export type ShippingSummary = {
  instagramId: string;
  quantity: number;
  totalLabel: string;
  items: string[];
};

type Notice = { tone: "success" | "error" | "info"; message: string } | null;
type Props = {
  dateId: string;
  summaries: ShippingSummary[];
  tab: ShippingTab;
  onTabChange: (tab: ShippingTab) => void;
  onCountsChange: (counts: ShippingCounts) => void;
  sortControl?: React.ReactNode;
  standalone?: boolean;
};

const fieldLabels: Array<{ key: keyof ShippingInfo; label: string; placeholder: string }> = [
  { key: "name", label: "성명", placeholder: "성함" },
  { key: "address", label: "주소", placeholder: "주소" },
  { key: "zipCode", label: "우편번호", placeholder: "선택 입력" },
  { key: "phone1", label: "전화번호", placeholder: "010-0000-0000" },
  { key: "phone2", label: "기타 연락처", placeholder: "선택 입력" },
  { key: "memo", label: "배송메세지", placeholder: "선택 입력" },
  { key: "items", label: "품목명 (인스타 아이디)", placeholder: "인스타 아이디" },
];

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stringToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pushUInt16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUInt32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(entries: Array<{ name: string; content: string }>) {
  const output: number[] = [];
  const centralDirectory: number[] = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  entries.forEach((entry) => {
    const nameBytes = stringToBytes(entry.name);
    const contentBytes = stringToBytes(entry.content);
    const checksum = crc32(contentBytes);
    const offset = output.length;

    pushUInt32(output, 0x04034b50);
    pushUInt16(output, 20);
    pushUInt16(output, 0);
    pushUInt16(output, 0);
    pushUInt16(output, dosTime);
    pushUInt16(output, dosDate);
    pushUInt32(output, checksum);
    pushUInt32(output, contentBytes.length);
    pushUInt32(output, contentBytes.length);
    pushUInt16(output, nameBytes.length);
    pushUInt16(output, 0);
    output.push(...nameBytes, ...contentBytes);

    pushUInt32(centralDirectory, 0x02014b50);
    pushUInt16(centralDirectory, 20);
    pushUInt16(centralDirectory, 20);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, dosTime);
    pushUInt16(centralDirectory, dosDate);
    pushUInt32(centralDirectory, checksum);
    pushUInt32(centralDirectory, contentBytes.length);
    pushUInt32(centralDirectory, contentBytes.length);
    pushUInt16(centralDirectory, nameBytes.length);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt32(centralDirectory, 0);
    pushUInt32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);
  });

  const centralDirectoryOffset = output.length;
  output.push(...centralDirectory);
  pushUInt32(output, 0x06054b50);
  pushUInt16(output, 0);
  pushUInt16(output, 0);
  pushUInt16(output, entries.length);
  pushUInt16(output, entries.length);
  pushUInt32(output, centralDirectory.length);
  pushUInt32(output, centralDirectoryOffset);
  pushUInt16(output, 0);

  return new Uint8Array(output);
}

function columnName(index: number) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function worksheetRow(rowIndex: number, values: string[]) {
  const cells = values
    .map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .join("");

  return `<row r="${rowIndex}">${cells}</row>`;
}

function createShippingWorkbook(header: string[], rows: string[][]) {
  const sheetRows = [
    '<row r="1"></row>',
    worksheetRow(2, header),
    ...rows.map((row, index) => worksheetRow(index + 3, row)),
  ].join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G${rows.length + 2}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${sheetRows}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>
</worksheet>`;

  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="배송주문" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]);
}

function detectedInstagramId(text: string) {
  const labeled = text.match(
    /(?:인스타그램(?:\s*아이디)?|인스타(?:\s*아이디)?|instagram(?:\s*id)?|아이디|id)\s*[:：=\-–—]?\s*(@?[a-z0-9._]{2,30})/i,
  )?.[1];
  if (labeled) return labeled;

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  return /^@?[a-z0-9._]{2,30}$/i.test(firstLine) ? firstLine : "";
}

function statusLabel(status: ShippingParticipant["status"]) {
  if (status === "READY") return "주문서 출력 대기";
  if (status === "COMPLETED") return "완료";
  return "미입금";
}

function statusStyles(status: ShippingParticipant["status"]) {
  if (status === "READY") return "border-[#D4D4D8] bg-[#F7F7F8]";
  if (status === "COMPLETED") return "border-[#BFDBFE] bg-[#EFF6FF]";
  return "border-[#E8E8EC] bg-white";
}

function statusBadgeStyles(status: ShippingParticipant["status"]) {
  if (status === "READY") return "bg-[#EDE9FE] text-[#5B21B6]";
  if (status === "COMPLETED") return "bg-white/80 text-[#1D4ED8]";
  return "bg-[#F4F4F5] text-[#52525B]";
}

function statusForTab(tab: ShippingTab): ShippingParticipant["status"] {
  if (tab === "ready") return "READY";
  if (tab === "completed") return "COMPLETED";
  return "WAITING";
}

function findPreviousShippingInfo(instagramId: string, currentRoundId: string) {
  const canonicalId = canonicalInstagramId(instagramId);
  return (
    readShippingRounds()
      .filter((candidate) => candidate.id !== currentRoundId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .flatMap((candidate) => candidate.participants)
      .find((participant) => canonicalInstagramId(participant.instagramId) === canonicalId && participant.shippingInfo)
      ?.shippingInfo ?? null
  );
}

export default function ShippingWorkspace({
  dateId,
  summaries,
  tab,
  onTabChange,
  onCountsChange,
  sortControl,
  standalone = false,
}: Props) {
  const [round, setRound] = useState<ShippingRound | null>(null);
  const [rawText, setRawText] = useState("");
  const [selectedInstagramId, setSelectedInstagramId] = useState("");
  const [participantSearch, setParticipantSearch] = useState("");
  const [draftInfo, setDraftInfo] = useState<ShippingInfo>(emptyShippingInfo());
  const [showReview, setShowReview] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const participantKey = summaries.map((summary) => canonicalInstagramId(summary.instagramId)).join("|");

  useEffect(() => {
    if (!standalone && summaries.length === 0) {
      setRound(null);
      return;
    }

    const seededRound = seedShippingRound(dateId, summaries.map((summary) => summary.instagramId));
    const summaryIds = new Set(summaries.map((summary) => canonicalInstagramId(summary.instagramId)));
    const existingParticipantsById = new Map(
      seededRound.participants.map((participant) => [canonicalInstagramId(participant.instagramId), participant]),
    );
    const participantsForCurrentMemo = summaries.map((summary) => {
      const existing = existingParticipantsById.get(canonicalInstagramId(summary.instagramId));

      if (existing && (existing.status !== "WAITING" || existing.shippingInfo)) {
        return existing;
      }

      const previousInfo = findPreviousShippingInfo(summary.instagramId, seededRound.id);

      return {
        instagramId: summary.instagramId,
        status: "WAITING" as const,
        shippingInfo: previousInfo ? { ...previousInfo, zipCode: "", items: summary.instagramId } : null,
      };
    });
    const standaloneParticipants = standalone
      ? seededRound.participants.filter((participant) => !summaryIds.has(canonicalInstagramId(participant.instagramId)))
      : [];
    const enrichedRound = { ...seededRound, participants: [...participantsForCurrentMemo, ...standaloneParticipants] };

    setRound(enrichedRound);
    if (enrichedRound.participants.some((participant, index) => participant !== seededRound.participants[index])) {
      saveShippingRound(enrichedRound);
      saveRemoteShippingRound(enrichedRound).catch(() => undefined);
    }
  }, [dateId, participantKey, standalone]);

  const summaryById = useMemo(() => {
    const nextSummaryById = new Map(summaries.map((summary) => [canonicalInstagramId(summary.instagramId), summary]));

    if (standalone) {
      (round?.participants ?? []).forEach((participant) => {
        const canonicalId = canonicalInstagramId(participant.instagramId);

        if (!nextSummaryById.has(canonicalId)) {
          nextSummaryById.set(canonicalId, {
            instagramId: participant.instagramId,
            quantity: 1,
            totalLabel: "주문서만",
            items: participant.shippingInfo ? [participant.shippingInfo.items || participant.instagramId] : [],
          });
        }
      });
    }

    return nextSummaryById;
  }, [round, standalone, summaries]);
  const counts = useMemo<ShippingCounts>(() => {
    const currentParticipants = (round?.participants ?? []).filter((participant) =>
      summaryById.has(canonicalInstagramId(participant.instagramId)),
    );

    return {
      waiting: currentParticipants.filter((participant) => participant.status === "WAITING").length,
      ready: currentParticipants.filter((participant) => participant.status === "READY").length,
      completed: currentParticipants.filter((participant) => participant.status === "COMPLETED").length,
    };
  }, [round, summaryById]);

  useEffect(() => onCountsChange(counts), [counts, onCountsChange]);

  const visibleParticipants = useMemo(() => {
    const targetStatus = statusForTab(tab);
    return (round?.participants ?? []).filter(
      (participant) => participant.status === targetStatus && summaryById.has(canonicalInstagramId(participant.instagramId)),
    );
  }, [round, summaryById, tab]);
  const searchableParticipants = useMemo(
    () =>
      (round?.participants ?? [])
        .filter((participant) => summaryById.has(canonicalInstagramId(participant.instagramId)))
        .map((participant) => participant.instagramId),
    [round, summaryById],
  );
  const participantSuggestions = useMemo(() => {
    const keyword = participantSearch.trim().toLowerCase();
    const candidates = searchableParticipants;

    return (keyword
      ? candidates.filter((instagramId) => instagramId.toLowerCase().includes(keyword))
      : candidates
    ).slice(0, 8);
  }, [participantSearch, searchableParticipants]);
  const highlightedParticipantId = canonicalInstagramId(selectedInstagramId);
  const runParticipantSearch = () => {
    const keyword = participantSearch.trim();

    if (!keyword) {
      return;
    }

    const matchedId =
      searchableParticipants.find((instagramId) => canonicalInstagramId(instagramId) === canonicalInstagramId(keyword)) ??
      participantSuggestions[0];

    if (matchedId) {
      setSelectedInstagramId(matchedId);
      setParticipantSearch("");
    }
  };
  const clearParticipantSearch = () => {
    setParticipantSearch("");
    setSelectedInstagramId("");
  };

  useEffect(() => {
    if (!highlightedParticipantId) {
      return;
    }

    document.getElementById(`shipping-card-${highlightedParticipantId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [highlightedParticipantId, tab]);

  const persistRound = (nextRound: ShippingRound) => {
    const savedRound = saveShippingRound(nextRound);
    setRound(savedRound);
    saveRemoteShippingRound(savedRound).catch(() => undefined);
    return savedRound;
  };

  const resetParser = () => {
    setRawText("");
    setSelectedInstagramId("");
    setParticipantSearch("");
    setDraftInfo(emptyShippingInfo());
    setShowReview(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const mapShippingInfo = (instagramId: string, shippingInfo: ShippingInfo, baseRound = round) => {
    if (!baseRound) return;

    persistRound({
      ...baseRound,
      participants: baseRound.participants.some(
        (participant) => canonicalInstagramId(participant.instagramId) === canonicalInstagramId(instagramId),
      )
        ? baseRound.participants.map((participant) =>
            canonicalInstagramId(participant.instagramId) === canonicalInstagramId(instagramId)
              ? { ...participant, shippingInfo, status: "READY" as const }
              : participant,
          )
        : [...baseRound.participants, { instagramId, shippingInfo, status: "READY" as const }],
    });
    onTabChange("ready");
    setNotice({ tone: "success", message: `${instagramId} 주문서를 출력 대기로 등록했습니다.` });
    resetParser();
    window.setTimeout(() => setNotice(null), 1800);
  };

  const processOrder = async (sourceText = rawText, forcedInstagramId = selectedInstagramId) => {
    if (!round || !sourceText.trim()) return;

    let workingRound = round;
    const participantIds = workingRound.participants.map((participant) => participant.instagramId);
    const parsed = parseKakaoOrder(sourceText, participantIds);
    const searchMatchedId = searchableParticipants.find(
      (instagramId) => canonicalInstagramId(instagramId) === canonicalInstagramId(participantSearch),
    );
    const requestedId = forcedInstagramId || searchMatchedId || parsed.instagramId || detectedInstagramId(sourceText);
    let participant = workingRound.participants.find(
      (candidate) => canonicalInstagramId(candidate.instagramId) === canonicalInstagramId(requestedId),
    );

    if (!participant && standalone && requestedId) {
      participant = { instagramId: requestedId.replace(/^@/, ""), status: "WAITING", shippingInfo: null };
      workingRound = persistRound({
        ...workingRound,
        participants: [...workingRound.participants, participant],
      });
    }

    if (!participant) {
      const detectedId = detectedInstagramId(sourceText);
      setShowReview(true);
      setDraftInfo(parsed.shippingInfo);
      setNotice(
        detectedId
          ? { tone: "error", message: `${detectedId}은(는) 현재 명단에 없는 아이디입니다. 다시 확인해주세요.` }
          : { tone: "info", message: "인스타 아이디를 찾지 못했습니다. 명단에서 한 명을 선택해주세요." },
      );
      return;
    }

    setParticipantSearch(participant.instagramId);
    const previousInfo = findPreviousShippingInfo(participant.instagramId, workingRound.id);
    const parsedInfo = parsed.shippingInfo;
    const nextInfo: ShippingInfo = {
      ...(previousInfo ?? emptyShippingInfo()),
      name: parsedInfo.name || previousInfo?.name || "",
      address: parsedInfo.address || previousInfo?.address || "",
      zipCode: "",
      phone1: normalizePhoneNumber(parsedInfo.phone1 || previousInfo?.phone1 || ""),
      phone2: normalizePhoneNumber(parsedInfo.phone1 || previousInfo?.phone1 || ""),
      memo: parsedInfo.memo || previousInfo?.memo || "",
      items: participant.instagramId,
    };
    setSelectedInstagramId(participant.instagramId);

    setDraftInfo(nextInfo);

    if (previousInfo && participant.status === "WAITING") {
      setShowReview(true);
      setNotice({ tone: "info", message: "과거 주문서 정보를 불러왔습니다. 확인 후 저장해주세요." });
      return;
    }

    if (isReadyShippingInfo(nextInfo)) {
      mapShippingInfo(participant.instagramId, nextInfo, workingRound);
      return;
    }

    setShowReview(true);
    setNotice({ tone: "info", message: "필수 정보가 일부 비어 있습니다. 확인 후 저장해주세요." });
  };

  const handleReviewSave = () => {
    if (!selectedInstagramId) {
      setNotice({ tone: "error", message: "매칭할 참여자를 먼저 선택해주세요." });
      return;
    }
    const nextInfo = {
      ...draftInfo,
      zipCode: "",
      phone1: normalizePhoneNumber(draftInfo.phone1),
      phone2: normalizePhoneNumber(draftInfo.phone1),
    };

    if (!isReadyShippingInfo(nextInfo)) {
      setNotice({ tone: "error", message: "성명, 주소, 전화번호, 품목명은 필수입니다." });
      return;
    }
    mapShippingInfo(selectedInstagramId, nextInfo);
  };

  const editParticipant = (participant: ShippingParticipant) => {
    setSelectedInstagramId(participant.instagramId);
    setDraftInfo(
      participant.shippingInfo
        ? { ...participant.shippingInfo, items: participant.shippingInfo.items || participant.instagramId }
        : { ...emptyShippingInfo(), items: participant.instagramId },
    );
    setShowReview(true);
    setNotice({ tone: "info", message: `${participant.instagramId} 배송 정보를 수정합니다.` });
    requestAnimationFrame(() => {
      document.getElementById(`shipping-review-${canonicalInstagramId(participant.instagramId)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  };

  const confirmWaitingParticipant = (participant: ShippingParticipant) => {
    if (!round || !participant.shippingInfo) return;

    const nextInfo = {
      ...participant.shippingInfo,
      zipCode: "",
      phone1: normalizePhoneNumber(participant.shippingInfo.phone1),
      phone2: normalizePhoneNumber(participant.shippingInfo.phone1),
      items: participant.instagramId,
    };

    persistRound({
      ...round,
      participants: round.participants.map((candidate) =>
        canonicalInstagramId(candidate.instagramId) === canonicalInstagramId(participant.instagramId)
          ? { ...candidate, shippingInfo: nextInfo, status: "READY" as const }
          : candidate,
      ),
    });
    setNotice({ tone: "success", message: `${participant.instagramId} 주문서를 출력 대기로 등록했습니다.` });
    window.setTimeout(() => setNotice(null), 1800);
  };

  const restoreParticipant = (instagramId: string) => {
    if (!round) return;
    persistRound({
      ...round,
      participants: round.participants.map((participant) =>
        canonicalInstagramId(participant.instagramId) === canonicalInstagramId(instagramId)
          ? { ...participant, status: "READY" }
          : participant,
      ),
    });
    onTabChange("ready");
  };

  const downloadReadyOrders = () => {
    if (!round) return;
    const readyParticipants = round.participants.filter(
      (participant): participant is ShippingParticipant & { shippingInfo: ShippingInfo } =>
        participant.status === "READY" &&
        participant.shippingInfo !== null &&
        summaryById.has(canonicalInstagramId(participant.instagramId)),
    );
    if (readyParticipants.length === 0) return;

    const header = ["받는분성명", "받는분 주소", "우편번호", "전화번호", "기타 연락처", "배송메세지", "품목명"];
    const rows = readyParticipants.map((participant) => {
      const info = participant.shippingInfo;
      return [info.name, info.address, "", info.phone1, info.phone2, info.memo, info.items];
    });
    const workbookBytes = createShippingWorkbook(header, rows);
    const blob = new Blob([workbookBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `unclozet-shipping-${dateId}-${readyParticipants.length}건.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    persistRound({
      ...round,
      participants: round.participants.map((participant) =>
        participant.status === "READY" && summaryById.has(canonicalInstagramId(participant.instagramId))
          ? { ...participant, status: "COMPLETED" }
          : participant,
      ),
    });
    onTabChange("completed");
    setNotice({ tone: "success", message: `${readyParticipants.length}건을 다운로드하고 완료로 이동했습니다.` });
  };

  const reviewInstagramId = canonicalInstagramId(selectedInstagramId);
  const isReviewInline = Boolean(
    showReview &&
      reviewInstagramId &&
      visibleParticipants.some(
        (participant) => canonicalInstagramId(participant.instagramId) === reviewInstagramId,
      ),
  );
  const reviewForm = (inline = false) => (
    <div
      id={inline ? `shipping-review-${reviewInstagramId}` : undefined}
      className={`${inline ? "mt-5 border-t border-[#D4D4D8] pt-5" : "rounded-lg border border-[#E8E8EC] bg-white p-4"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-['General_Sans'] text-[17px] font-bold">주문서 정보 확인</h3>
        <button
          type="button"
          onClick={() => setShowReview(false)}
          className="h-8 rounded-md border border-[#D4D4D8] bg-white px-3 text-[12px] font-bold text-[#71717A]"
        >
          닫기
        </button>
      </div>
      {inline ? (
        <p className="mt-2 break-all text-[13px] font-bold text-[#4F46E5]">{selectedInstagramId}</p>
      ) : (
        <label className="mt-3 grid gap-1.5 text-[12px] font-bold text-[#52525B]">
          인스타 아이디
          <select value={selectedInstagramId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedInstagramId(event.target.value)} className="h-11 rounded-md border border-[#D4D4D8] bg-white px-3 text-[14px] font-medium text-[#0A0A0A] outline-none focus:border-[#6366F1]">
            <option value="">참여자 선택</option>
            {(round?.participants ?? []).map((participant) => <option key={participant.instagramId} value={participant.instagramId}>{participant.instagramId}</option>)}
          </select>
        </label>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fieldLabels.map((field) => (
          <label key={field.key} className={`${field.key === "name" ? "sm:col-span-2" : ""} grid gap-1.5 text-[12px] font-bold text-[#52525B]`}>
            {field.label}
            <input
              value={draftInfo[field.key]}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const nextValue = event.target.value;
                setDraftInfo((current) =>
                  field.key === "phone1"
                    ? { ...current, phone1: nextValue, phone2: nextValue }
                    : { ...current, [field.key]: nextValue },
                );
              }}
              placeholder={field.placeholder}
              className="h-10 rounded-md border border-[#D4D4D8] bg-white px-3 text-[13px] font-medium text-[#0A0A0A] outline-none focus:border-[#6366F1]"
            />
          </label>
        ))}
      </div>
      <button type="button" onClick={handleReviewSave} className="mt-4 h-11 w-full rounded-md bg-[#6366F1] px-4 text-[14px] font-bold text-white hover:bg-[#4F46E5]">주문서 저장</button>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E8E8EC] bg-white px-3 py-3 md:px-4">
        <div className="flex min-w-0 overflow-x-auto" role="tablist" aria-label="배송 상태">
          {([
            ["waiting", standalone ? "정보 확인 필요" : "미입금", counts.waiting],
            ["ready", "주문서 출력 대기", counts.ready],
            ["completed", "완료", counts.completed],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => onTabChange(value)}
              className={`h-10 shrink-0 border-b-2 px-3 text-[13px] font-bold md:px-4 md:text-[14px] ${
                tab === value ? "border-[#6366F1] text-[#4F46E5]" : "border-transparent text-[#71717A]"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortControl}
          <button
            type="button"
            onClick={downloadReadyOrders}
            disabled={counts.ready === 0}
            className="h-11 rounded-md bg-[#6366F1] px-4 text-[13px] font-bold text-white transition hover:bg-[#4F46E5] disabled:cursor-not-allowed disabled:bg-[#E4E4E7] disabled:text-[#A1A1AA]"
          >
            {standalone ? "주문서 엑셀 다운로드" : "출력 대기 엑셀 다운로드"} ({counts.ready}건)
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:h-[calc(100dvh-2rem)] lg:min-h-[520px] lg:max-h-[760px] lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start lg:overflow-hidden">
        <div className="grid min-w-0 gap-4 lg:h-full lg:content-start lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
          {visibleParticipants.length > 0 ? visibleParticipants.map((participant) => {
            const participantCanonicalId = canonicalInstagramId(participant.instagramId);
            const summary = summaryById.get(participantCanonicalId);
            const isHighlighted = highlightedParticipantId === participantCanonicalId;
            if (!summary) return null;
            return (
              <article
                id={`shipping-card-${participantCanonicalId}`}
                key={participant.instagramId}
                className={`rounded-xl border p-5 transition ${
                  isHighlighted
                    ? "border-[#6366F1] bg-[#F5F3FF] shadow-[0_0_0_3px_rgba(99,102,241,0.16)]"
                    : statusStyles(participant.status)
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-all font-['General_Sans'] text-[24px] font-bold leading-tight text-[#0A0A0A]">{summary.instagramId}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusBadgeStyles(participant.status)}`}>
                        {standalone && participant.status === "WAITING" ? "정보 확인 필요" : statusLabel(participant.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-medium text-[#6B6B6B]">
                      {standalone ? "메모 없이 등록된 주문서" : `총 ${summary.quantity}개 · ${summary.totalLabel}`}
                    </p>
                    {participant.shippingInfo ? (
                      <div className="mt-3 grid gap-1.5 rounded-lg border border-[#E8E8EC] bg-white/70 p-3 text-[12px] leading-5 text-[#52525B]">
                        <p><span className="font-bold text-[#0A0A0A]">성명</span> {participant.shippingInfo.name}</p>
                        <p><span className="font-bold text-[#0A0A0A]">주소</span> {participant.shippingInfo.address}</p>
                        <p><span className="font-bold text-[#0A0A0A]">연락처</span> {participant.shippingInfo.phone1}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {participant.status === "WAITING" && participant.shippingInfo ? (
                      <button type="button" onClick={() => confirmWaitingParticipant(participant)} className="h-9 rounded-md bg-[#111827] px-3 text-[12px] font-bold text-white transition hover:bg-black">확인</button>
                    ) : null}
                    {participant.shippingInfo ? (
                      <button type="button" onClick={() => editParticipant(participant)} className="h-9 rounded-md border border-[#D4D4D8] bg-white px-3 text-[12px] font-bold text-[#52525B]">정보 수정</button>
                    ) : null}
                    {participant.status === "COMPLETED" ? (
                      <button type="button" onClick={() => restoreParticipant(participant.instagramId)} className="h-9 rounded-md border border-[#CBD5E1] bg-white px-3 text-[12px] font-bold text-[#64748B] transition hover:border-[#94A3B8] hover:bg-[#F8FAFC] hover:text-[#475569]">출력 대기로 되돌리기</button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.items.map((item, index) => (
                    <span key={`${summary.instagramId}-${index}`} className="rounded-full bg-[#F1F1F4] px-3 py-1 font-['JetBrains_Mono'] text-[12px] font-medium text-[#6B6B6B]">{item}</span>
                  ))}
                </div>
                {showReview && reviewInstagramId === canonicalInstagramId(participant.instagramId)
                  ? reviewForm(true)
                  : null}
              </article>
            );
          }) : (
            <div className="rounded-xl border border-dashed border-[#D4D4D8] bg-white p-8 text-center text-[14px] text-[#A1A1AA]">
              {standalone ? "이 상태의 주문서가 없습니다." : "이 상태의 참여자가 없습니다."}
            </div>
          )}
        </div>

        <aside className="grid gap-3 lg:h-full lg:content-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <div className="rounded-lg border border-[#E8E8EC] bg-white p-3">
            <label className="grid gap-1.5 text-[12px] font-bold text-[#52525B]">
              아이디 검색
              <div className="relative">
                <input
                  value={participantSearch}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const nextValue = event.target.value;
                    setParticipantSearch(nextValue);
                    const matchedId = searchableParticipants.find(
                      (instagramId) => canonicalInstagramId(instagramId) === canonicalInstagramId(nextValue),
                    );
                    setSelectedInstagramId(matchedId ?? "");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runParticipantSearch();
                    }

                    if (event.key === "Escape") {
                      clearParticipantSearch();
                    }
                  }}
                  placeholder="아이디 입력"
                  className="h-9 w-full rounded-md border border-[#D4D4D8] bg-white pl-3 pr-16 text-[13px] font-medium text-[#0A0A0A] outline-none focus:border-[#6366F1]"
                />
                {participantSearch ? (
                  <button
                    type="button"
                    onClick={clearParticipantSearch}
                    aria-label="검색 지우기"
                    className="absolute right-8 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-[#A1A1AA] hover:bg-[#F4F4F5] hover:text-[#52525B]"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={runParticipantSearch}
                  aria-label="아이디 검색"
                  className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#4F46E5]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4.5-4.5" />
                  </svg>
                </button>
              </div>
            </label>
            {participantSearch.trim() && participantSuggestions.length > 0 ? (
              <div className="mt-2 grid max-h-48 overflow-y-auto rounded-md border border-[#E8E8EC] bg-white p-1 shadow-sm">
                {participantSuggestions.map((instagramId) => (
                  <button
                    key={instagramId}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedInstagramId(instagramId);
                      setParticipantSearch("");
                    }}
                    className="rounded px-2 py-2 text-left font-['JetBrains_Mono'] text-[12px] font-medium text-[#3F3F46] hover:bg-[#F4F4F5]"
                  >
                    {instagramId}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[#E8E8EC] bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-['General_Sans'] text-[19px] font-bold">주문서 빠른 등록</h2>
                <p className="mt-1 text-[12px] text-[#71717A]">내용을 붙여넣고 등록 버튼을 눌러주세요.</p>
              </div>
              {rawText ? <button type="button" onClick={resetParser} className="h-8 rounded-md border border-[#E8E8EC] px-3 text-[12px] font-medium text-[#71717A]">비우기</button> : null}
            </div>
            <textarea
              ref={textareaRef}
              value={rawText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setRawText(event.target.value)}
              className="min-h-[140px] w-full resize-y rounded-lg border border-[#D4D4D8] bg-[#FAFAFA] p-4 font-['JetBrains_Mono'] text-[14px] leading-6 outline-none transition placeholder:text-[#A1A1AA] focus:border-[#6366F1] focus:ring-[3px] focus:ring-[#6366F1]/15"
              placeholder={"인스타 아이디\n받으실 분 성함\n주소\n연락처"}
              spellCheck={false}
            />
            <button type="button" onClick={() => processOrder()} disabled={!rawText.trim()} className="mt-3 h-11 w-full rounded-md bg-[#111827] px-4 text-[14px] font-bold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#E4E4E7] disabled:text-[#A1A1AA]">주문서 등록</button>
          </div>

          {notice ? (
            <div role="status" className={`rounded-lg border px-4 py-3 text-[13px] font-medium leading-5 ${notice.tone === "success" ? "border-[#86EFAC] bg-[#F0FDF4] text-[#166534]" : notice.tone === "error" ? "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"}`}>{notice.message}</div>
          ) : null}

          {showReview && !isReviewInline ? reviewForm() : null}
        </aside>
      </div>
    </div>
  );
}

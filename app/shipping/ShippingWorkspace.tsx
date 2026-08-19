"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalInstagramId,
  emptyShippingInfo,
  isReadyShippingInfo,
  parseKakaoOrder,
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
type PostcodeCandidate = {
  zipCode: string;
  roadAddress: string;
  jibunAddress: string;
};
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
  { key: "zipCode", label: "우편번호", placeholder: "5자리 우편번호" },
  { key: "phone1", label: "전화번호", placeholder: "010-0000-0000" },
  { key: "phone2", label: "기타 연락처", placeholder: "선택 입력" },
  { key: "memo", label: "배송메세지", placeholder: "선택 입력" },
  { key: "items", label: "품목명 (인스타 아이디)", placeholder: "인스타 아이디" },
];

function escapeCsvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
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
  const [draftInfo, setDraftInfo] = useState<ShippingInfo>(emptyShippingInfo());
  const [showReview, setShowReview] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [postcodeCandidates, setPostcodeCandidates] = useState<PostcodeCandidate[]>([]);
  const [isLookingUpPostcode, setIsLookingUpPostcode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const participantKey = summaries.map((summary) => canonicalInstagramId(summary.instagramId)).join("|");

  useEffect(() => {
    if (!standalone && summaries.length === 0) {
      setRound(null);
      return;
    }

    setRound(seedShippingRound(dateId, summaries.map((summary) => summary.instagramId)));
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

  const persistRound = (nextRound: ShippingRound) => setRound(saveShippingRound(nextRound));

  const resetParser = () => {
    setRawText("");
    setSelectedInstagramId("");
    setDraftInfo(emptyShippingInfo());
    setShowReview(false);
    setPostcodeCandidates([]);
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

    setPostcodeCandidates([]);

    let workingRound = round;
    const participantIds = workingRound.participants.map((participant) => participant.instagramId);
    const parsed = parseKakaoOrder(sourceText, participantIds);
    const requestedId = forcedInstagramId || parsed.instagramId || detectedInstagramId(sourceText);
    let participant = workingRound.participants.find(
      (candidate) => canonicalInstagramId(candidate.instagramId) === canonicalInstagramId(requestedId),
    );

    if (!participant && standalone && requestedId) {
      participant = { instagramId: requestedId.replace(/^@/, ""), status: "WAITING", shippingInfo: null };
      workingRound = saveShippingRound({
        ...workingRound,
        participants: [...workingRound.participants, participant],
      });
      setRound(workingRound);
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

    let nextInfo: ShippingInfo = {
      ...parsed.shippingInfo,
      items: participant.instagramId,
    };
    setSelectedInstagramId(participant.instagramId);

    if (!nextInfo.zipCode.trim() && nextInfo.address.trim()) {
      setIsLookingUpPostcode(true);
      setNotice({ tone: "info", message: "주소에서 우편번호를 찾고 있습니다." });

      try {
        const response = await fetch("/api/postcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: nextInfo.address }),
        });
        const result = (await response.json()) as {
          candidates?: PostcodeCandidate[];
          error?: string;
          code?: string;
        };

        if (!response.ok) {
          setDraftInfo(nextInfo);
          setShowReview(true);
          setNotice({
            tone: "error",
            message:
              result.code === "NOT_CONFIGURED"
                ? "우편번호 자동 조회 설정이 필요합니다. 우편번호를 직접 입력하거나 API 승인키를 설정해주세요."
                : result.error || "우편번호를 자동으로 찾지 못했습니다. 직접 확인해주세요.",
          });
          return;
        }

        const candidates = result.candidates ?? [];
        const uniqueZipCodes = Array.from(new Set(candidates.map((candidate) => candidate.zipCode)));

        if (uniqueZipCodes.length === 1) {
          nextInfo = { ...nextInfo, zipCode: uniqueZipCodes[0] };
        } else {
          setDraftInfo(nextInfo);
          setPostcodeCandidates(candidates);
          setShowReview(true);
          setNotice({
            tone: "info",
            message:
              candidates.length > 0
                ? "주소 검색 결과가 여러 개입니다. 알맞은 우편번호를 선택해주세요."
                : "주소에서 우편번호를 찾지 못했습니다. 주소를 확인하고 직접 입력해주세요.",
          });
          return;
        }
      } catch {
        setDraftInfo(nextInfo);
        setShowReview(true);
        setNotice({ tone: "error", message: "우편번호 조회 중 오류가 발생했습니다. 직접 확인해주세요." });
        return;
      } finally {
        setIsLookingUpPostcode(false);
      }
    }

    setDraftInfo(nextInfo);

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
    if (!isReadyShippingInfo(draftInfo)) {
      setNotice({ tone: "error", message: "성명, 주소, 5자리 우편번호, 전화번호, 품목명은 필수입니다." });
      return;
    }
    mapShippingInfo(selectedInstagramId, draftInfo);
  };

  const editParticipant = (participant: ShippingParticipant) => {
    setPostcodeCandidates([]);
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
      return [info.name, info.address, info.zipCode, info.phone1, info.phone2, info.memo, info.items];
    });
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `unclozet-shipping-${dateId}-${readyParticipants.length}건.csv`;
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
        {postcodeCandidates.length > 0 ? (
          <div className="grid gap-2 rounded-lg border border-[#DDD6FE] bg-[#F5F3FF] p-3 sm:col-span-2">
            <p className="text-[12px] font-bold text-[#5B21B6]">주소에 맞는 우편번호를 선택해주세요.</p>
            {postcodeCandidates.map((candidate) => (
              <button
                key={`${candidate.zipCode}-${candidate.roadAddress}`}
                type="button"
                onClick={() => {
                  setDraftInfo((current) => ({ ...current, zipCode: candidate.zipCode }));
                  setPostcodeCandidates([]);
                  setNotice({ tone: "info", message: `${candidate.zipCode} 우편번호를 선택했습니다. 정보를 확인하고 저장해주세요.` });
                }}
                className="rounded-md border border-[#DDD6FE] bg-white px-3 py-2 text-left text-[12px] leading-5 text-[#3F3F46] hover:border-[#8B5CF6]"
              >
                <strong className="mr-2 text-[#5B21B6]">{candidate.zipCode}</strong>
                {candidate.roadAddress}
              </button>
            ))}
          </div>
        ) : null}
        {fieldLabels.map((field) => (
          <label key={field.key} className={`${field.key === "name" ? "sm:col-span-2" : ""} grid gap-1.5 text-[12px] font-bold text-[#52525B]`}>
            {field.label}
            <input
              value={draftInfo[field.key]}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftInfo((current) => ({ ...current, [field.key]: event.target.value }))}
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
            const summary = summaryById.get(canonicalInstagramId(participant.instagramId));
            if (!summary) return null;
            return (
              <article key={participant.instagramId} className={`rounded-xl border p-5 transition ${statusStyles(participant.status)}`}>
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
                      <p className="mt-3 break-words text-[13px] leading-5 text-[#52525B]">
                        {participant.shippingInfo.name} · {participant.shippingInfo.phone1}<br />
                        {participant.shippingInfo.address}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
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
            <button type="button" onClick={() => processOrder()} disabled={!rawText.trim() || isLookingUpPostcode} className="mt-3 h-11 w-full rounded-md bg-[#111827] px-4 text-[14px] font-bold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#E4E4E7] disabled:text-[#A1A1AA]">{isLookingUpPostcode ? "우편번호 확인 중" : "주문서 등록"}</button>
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

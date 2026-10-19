"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { Check, Copy, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { createWorkbook } from "../dashboard-v2/workbook";
import { useCopy, useRun } from "./admin-v2-shared";
import { COURIERS, detectTrackingColumns, matchTrackingRows, paymentGuideText, setTracking, submitOrder, trackingRowsFrom, type SubmitResult, type TrackingColumns, type TrackingMatch } from "./model";
import { priceCart } from "./pricing";
import { remoteAreaLabel, remoteAreaOf } from "./remote-area";
import { updateGroupBuyState } from "./store";
import type { CustomerInput, GbOrder, GroupBuy, GroupBuyState } from "./types";
import { absoluteUrl, CartPicker, cartLines, downloadBytes, formatPhoneInput, lookupPath, won, type Cart } from "./ui";

// 공구 관리 v2의 수기 주문·송장 엑셀 창. 규칙은 v1과 같은 model 함수를 쓴다.

/** 가운데 뜨는 창. Esc·바깥·X로 닫고, 열려 있는 동안 뒤 화면 스크롤을 막는다. */
export function Modal({ title, description, onClose, children, footer, wide = false }: { title: string; description?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return <div className="gbx-modal-layer">
    <div className="gbx-panel-dim" onClick={onClose} aria-hidden="true" />
    <section className={`gbx-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="gbx-modal-head"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div><button type="button" className="gbx-icon-btn" aria-label="닫기 (Esc)" onClick={onClose}><X /></button></header>
      <div className="gbx-modal-body">{children}</div>
      {footer ? <footer className="gbx-modal-foot">{footer}</footer> : null}
    </section>
  </div>;
}

// ── 수기 주문 ────────────────────────────────────────────

type ManualInput = Omit<CustomerInput, "pin">;
const emptyManual: ManualInput = { customerName: "", phone: "", recipientName: "", recipientPhone: "", postcode: "", address: "", addressDetail: "", shippingMessage: "", depositorName: "" };

export function ManualOrderV2({ groupBuy, close }: { groupBuy: GroupBuy; close: () => void }) {
  const copy = useCopy();
  const [cart, setCart] = useState<Cart>({});
  const [input, setInput] = useState<ManualInput>(emptyManual);
  const [same, setSame] = useState(true);
  const [error, setError] = useState("");
  const [overStock, setOverStock] = useState(false);
  const [created, setCreated] = useState<GbOrder | null>(null);
  const priced = priceCart(groupBuy, cartLines(cart), input.postcode, input.address);
  const area = remoteAreaOf(input.postcode, input.address);
  const set = (key: keyof ManualInput, value: string) => { setInput((current) => ({ ...current, [key]: value, ...(key === "customerName" && current.depositorName === current.customerName ? { depositorName: value } : {}) })); setError(""); };

  function submit(allow: boolean) {
    const digits = input.phone.replace(/\D/g, "");
    const data: CustomerInput = { ...input, ...(same ? { recipientName: input.customerName, recipientPhone: input.phone } : {}), depositorName: input.depositorName || input.customerName, pin: digits.slice(-4) };
    const result = updateGroupBuyState<SubmitResult>((current) => { const outcome = submitOrder(current, { groupBuyId: groupBuy.id, lines: cartLines(cart), input: data, expectedTotal: null, source: "manual", allowOverStock: allow }); return { state: outcome.ok ? outcome.state : current, value: outcome }; })!;
    if (result.ok) { setCreated(result.order); return; }
    if (result.code === "STOCK") { setOverStock(true); setError(result.message); return; }
    setError(result.message);
  }

  if (created) {
    const guide = paymentGuideText(created, groupBuy, absoluteUrl(lookupPath()));
    return <Modal title="수기 주문을 등록했어요" description={<>{created.orderNo} · 조회 비밀번호는 휴대폰 뒷 4자리예요.</>} onClose={close}
      footer={<><button type="button" className="gbx-btn ghost" onClick={close}>닫기</button><button type="button" className="gbx-btn" onClick={() => { setCreated(null); setCart({}); setInput(emptyManual); setSame(true); }}>하나 더 등록</button><button type="button" className="gbx-btn primary" onClick={() => copy(guide, "댓글 답변용 안내 문구")}><Copy />안내 문구 복사</button></>}>
      <div className="gbx-done-head"><span><Check /></span><div><strong>{created.customerName} · {won(created.total)}</strong><small>입금 대기로 들어갔어요. 아래 문구를 댓글·문자로 보내주세요.</small></div></div>
      <pre className="gbx-guide">{guide}</pre>
    </Modal>;
  }

  return <Modal title="수기 주문 등록" description="댓글·안부글로 들어온 주문을 고객 주문서와 같은 규칙으로 넣어요. 마감 후에도 등록할 수 있어요." onClose={close} wide
    footer={<>
      <span className="gbx-modal-total">{priced.quantity ? <>{priced.quantity}개 · 상품 {won(priced.subtotal)} + 배송 {won(priced.shippingFee)}{area ? ` (${remoteAreaLabel(area)})` : ""} = <b>{won(priced.total)}</b></> : "상품을 골라주세요"}</span>
      <button type="button" className="gbx-btn ghost" onClick={close}>취소</button>
      {overStock ? <button type="button" className="gbx-btn danger" onClick={() => submit(true)}>재고 초과 허용하고 등록</button> : <button type="button" className="gbx-btn primary" disabled={!priced.quantity} onClick={() => submit(false)}>{priced.quantity ? `${won(priced.total)} 주문 등록` : "주문 등록"}</button>}
    </>}>
    <div className="gbx-manual">
      <section>
        <h3>상품</h3>
        <CartPicker groupBuy={groupBuy} cart={cart} onChange={(next) => { setCart(next); setOverStock(false); setError(""); }} compact allowOverStock />
      </section>
      <section>
        <h3>주문자</h3>
        <div className="gbx-form">
          <label>주문자명<input value={input.customerName} onChange={(e) => set("customerName", e.target.value)} autoFocus /></label>
          <label>휴대폰<input value={input.phone} onChange={(e) => set("phone", formatPhoneInput(e.target.value))} inputMode="numeric" placeholder="010-0000-0000" /></label>
          <label>입금자명<input value={input.depositorName} onChange={(e) => set("depositorName", e.target.value)} placeholder="비우면 주문자명" /></label>
          <label className="gbx-check-label"><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />받는 분 = 주문자</label>
          {!same ? <><label>받는 분<input value={input.recipientName} onChange={(e) => set("recipientName", e.target.value)} /></label><label>받는 분 연락처<input value={input.recipientPhone} onChange={(e) => set("recipientPhone", formatPhoneInput(e.target.value))} inputMode="numeric" /></label></> : null}
        </div>
        <h3>배송지</h3>
        <div className="gbx-form">
          <label>우편번호<input value={input.postcode} onChange={(e) => set("postcode", e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="제주·도서산간 자동 판별" /></label>
          <label>배송 메시지<input value={input.shippingMessage} onChange={(e) => set("shippingMessage", e.target.value)} /></label>
          <label className="full">주소<input value={input.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="full">상세 주소<input value={input.addressDetail} onChange={(e) => set("addressDetail", e.target.value)} /></label>
        </div>
        {area ? <p className="gbx-help red">{remoteAreaLabel(area)} 주소라 배송비 {won(priced.shippingFee)}이 적용돼요.</p> : null}
      </section>
    </div>
    {error ? <p className={overStock ? "gbx-warn" : "gbx-error"}>{error}{overStock ? " — 한정 수량을 넘겨 등록하려면 ‘재고 초과 허용하고 등록’을 누르세요." : ""}</p> : null}
  </Modal>;
}

// ── 송장 엑셀 가져오기 ───────────────────────────────────

type Sheet = { fileName: string; rows: string[][]; headerRow: number; columns: TrackingColumns };

export function TrackingImportV2({ state, groupBuy, close }: { state: GroupBuyState; groupBuy: GroupBuy; close: () => void }) {
  const run = useRun();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [defaultCourier, setDefaultCourier] = useState<string>(COURIERS[0]);
  const [manual, setManual] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const completed = state.orders.filter((order) => order.groupBuyId === groupBuy.id && order.status === "COMPLETED" && !order.cancelledAt);
  const waitingTracking = completed.filter((order) => !order.trackingNo).length;
  const byId = new Map(completed.map((order) => [order.id, order]));
  const matches: TrackingMatch[] = useMemo(() => sheet ? matchTrackingRows(state, groupBuy.id, trackingRowsFrom(sheet.rows, sheet.headerRow, sheet.columns, defaultCourier)) : [], [sheet, state, groupBuy.id, defaultCourier]);
  const auto = matches.filter((match) => match.candidates.length === 1);
  const needs = matches.filter((match) => match.candidates.length !== 1);
  const assignments = matches.map((match) => ({ match, orderId: manual[match.row] ?? (match.candidates.length === 1 ? match.candidates[0] : "") })).filter((item) => item.orderId);
  const duplicateTargets = new Set(assignments.map((item) => item.orderId).filter((id, index, all) => all.indexOf(id) !== index));
  const unresolved = needs.filter((match) => !manual[match.row]).length;

  async function read(file: File) {
    setError(""); setManual({});
    try {
      const sheets = await readXlsxFile(file);
      const data = (sheets[0]?.data ?? []).map((row) => row.map((cell) => cell == null ? "" : cell instanceof Date ? cell.toISOString() : String(cell)));
      const detected = detectTrackingColumns(data);
      setSheet({ fileName: file.name, rows: data, headerRow: detected?.headerRow ?? 0, columns: detected?.columns ?? { name: 0, phone: 1, trackingNo: 2, courier: null } });
      if (!detected) setError("수령인·전화번호·송장번호 칸을 찾지 못했어요. 아래에서 칸을 직접 골라주세요.");
    } catch { setError("엑셀 파일을 읽지 못했어요. .xlsx 파일인지 확인해 주세요."); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  /** 테스트용: 송장 대기 주문으로 택배사 송장 엑셀을 흉내 낸다(일부러 매칭 안 되는 행 1개 포함). */
  function sampleFile() {
    const rows = completed.filter((order) => !order.trackingNo).map((order, index) => [order.recipientName, order.recipientPhone, `5${String(Date.now()).slice(-7)}${String(index).padStart(4, "0")}`, "CJ대한통운", order.address]);
    if (!rows.length) { setError("송장 대기 주문이 없어요. 먼저 택배 엑셀을 출력하세요."); return; }
    rows.push(["없는고객", "010-0000-0000", `5${String(Date.now()).slice(-7)}9999`, "CJ대한통운", "테스트 주소"]);
    downloadBytes(createWorkbook([{ name: "운송장", rows: [["수하인명", "수하인전화번호", "운송장번호", "택배사", "주소"], ...rows] }]), `샘플-택배사-송장-${rows.length}행.xlsx`);
  }

  function confirm() {
    if (duplicateTargets.size) { setError("한 주문에 송장 2개가 연결돼 있어요. 빨간 줄의 연결을 다시 골라주세요."); return; }
    if (run((current) => setTracking(current, assignments.map(({ match, orderId }) => ({ orderId, courier: match.courier, trackingNo: match.trackingNo })), "excel"), `송장 ${assignments.length}건을 등록했어요. 고객 조회에 보여요.`)) close();
  }

  const header = sheet ? sheet.rows[sheet.headerRow] ?? [] : [];
  const columnSelect = (key: keyof TrackingColumns, label: string, optional = false) => <label>{label}<select value={sheet!.columns[key] ?? ""} onChange={(e) => setSheet({ ...sheet!, columns: { ...sheet!.columns, [key]: e.target.value === "" ? null : Number(e.target.value) } })}>{optional ? <option value="">없음 (기본 택배사)</option> : null}{header.map((cell, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}열 · {cell || "(빈 칸)"}</option>)}</select></label>;
  const orderLabel = (id: string) => { const order = byId.get(id); return order ? `#${order.orderNo.slice(-4)} · ${order.recipientName} ${order.recipientPhone.slice(-4)} · ${order.items.map((item) => `${item.itemName ?? item.optionName}×${item.quantity}`).join(", ")}${order.trackingNo ? " (송장 있음)" : ""}` : id; };
  const MatchRow = ({ match }: { match: TrackingMatch }) => {
    const chosen = manual[match.row] ?? (match.candidates.length === 1 ? match.candidates[0] : "");
    const options = match.candidates.length ? match.candidates : completed.map((order) => order.id);
    const kind = match.candidates.length === 1 ? "auto" : match.candidates.length ? "multi" : "none";
    return <li className={`gbx-match ${kind} ${duplicateTargets.has(chosen) ? "dup" : ""}`}>
      <div><small>{match.row}행 · {kind === "auto" ? "자동 연결" : kind === "multi" ? `후보 ${match.candidates.length}건` : "연결할 주문 없음"}</small><strong>{match.name || "(이름 없음)"} · {match.phone}</strong><span className="gbx-mono">{match.courier} {match.trackingNo}</span></div>
      <select value={chosen} onChange={(e) => setManual({ ...manual, [match.row]: e.target.value })} aria-label={`${match.row}행 연결할 주문`}>
        <option value="">{kind === "multi" ? "후보 중 고르기…" : kind === "auto" ? "연결 안 함" : "건너뛰기 (또는 직접 고르기)"}</option>
        {options.map((id) => <option key={id} value={id}>{orderLabel(id)}</option>)}
      </select>
    </li>;
  };

  return <Modal title="송장 엑셀 올리기" description={<>택배사에서 받은 송장 엑셀을 올리면 받는 분 이름·전화번호로 송장 대기 주문 <b>{waitingTracking}건</b>과 맞춰요.</>} onClose={close} wide
    footer={<>
      <span className="gbx-modal-total">{sheet ? <>등록 예정 <b>{assignments.length}건</b>{unresolved ? ` · 확인 필요 ${unresolved}건 (건너뛰어도 돼요)` : ""}</> : ""}</span>
      <button type="button" className="gbx-btn ghost" onClick={close}>닫기</button>
      <button type="button" className="gbx-btn primary" disabled={!assignments.length} onClick={confirm}>송장 {assignments.length}건 등록</button>
    </>}>
    <input ref={inputRef} type="file" className="sr-only" accept=".xlsx" onChange={(e) => { const file = e.target.files?.[0]; if (file) void read(file); }} />
    {!sheet ? <>
      <button type="button" className={`gbx-drop ${dragOver ? "over" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) void read(file); }}>
        <FileSpreadsheet /><strong>송장 엑셀(.xlsx)을 끌어다 놓거나 눌러서 고르세요</strong><small>수하인명 · 전화번호 · 운송장번호 칸을 자동으로 찾아요</small>
      </button>
      <button type="button" className="gbx-link" onClick={sampleFile}><Download />테스트용 샘플 송장 엑셀 만들기</button>
    </> : <>
      <div className="gbx-file"><FileSpreadsheet /><strong>{sheet.fileName}</strong><span>{matches.length}행</span><button type="button" className="gbx-btn sm" onClick={() => inputRef.current?.click()}><Upload />다른 파일</button></div>
      <details className="gbx-fold">
        <summary>읽은 칸 확인 · 기본 택배사 {defaultCourier}</summary>
        <div className="gbx-columns">{columnSelect("name", "받는 분")}{columnSelect("phone", "전화번호")}{columnSelect("trackingNo", "송장번호")}{columnSelect("courier", "택배사", true)}<label>기본 택배사<select value={defaultCourier} onChange={(e) => setDefaultCourier(e.target.value)}>{COURIERS.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      </details>
      <dl className="gbx-match-sum"><div><dt>자동 연결</dt><dd>{auto.length}</dd></div><div><dt>확인 필요</dt><dd className={needs.length ? "red" : ""}>{needs.length}</dd></div><div><dt>등록 예정</dt><dd>{assignments.length}</dd></div></dl>
      {needs.length ? <><h3 className="gbx-match-title">확인이 필요한 행</h3><ul className="gbx-matches">{needs.map((match) => <MatchRow key={match.row} match={match} />)}</ul></> : <p className="gbx-help">모든 행이 주문 1건과 바로 연결됐어요.</p>}
      {auto.length ? <><button type="button" className="gbx-link" onClick={() => setShowAuto((value) => !value)}>{showAuto ? "자동 연결 목록 접기" : `자동 연결된 ${auto.length}건 보기`}</button>{showAuto ? <ul className="gbx-matches">{auto.map((match) => <MatchRow key={match.row} match={match} />)}</ul> : null}</> : null}
      {!matches.length ? <p className="gbx-help">송장번호가 있는 행이 없어요. 위 ‘읽은 칸 확인’에서 칸을 다시 골라주세요.</p> : null}
    </>}
    {error ? <p className="gbx-error">{error}</p> : null}
  </Modal>;
}

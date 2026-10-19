"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Plus, Search, X } from "lucide-react";
import {
  addBroadcast, addCustomerCheck, confirmPreviousInfo, customerCheckCount, customerFor, customerStatusLabel, ensureCustomer, setCustomerBlocked, deleteBroadcast, deliveryIssues, editOrder, exportReadyOrders, matchOrder, matchingCandidates, orderIssues,
  registerOrder, renameBroadcast, resolveConflict, restoreOrder, saveDraft, saveSettlement, statusLabels,
} from "./model";
import { analyzeSettlement } from "./settlement";
import type { Broadcast, Customer, Delivery, Order, OrderStatus } from "./types";
import { useDashboard } from "./provider";
import { Shell } from "./shell";
import { Modal } from "../group-buy/dialogs-v2";
import "../group-buy/admin-v2.css";
import "./broadcasts-v2.css";

// 방송 내역 v2 — 공구 v2와 같은 결(흰 바탕·얇은 선·검정 버튼·빨간 금액)로 다시 짠 화면.
// 정산은 위에 작게 두고 주문 목록이 중심이다. 주문 패널에서 다음 주문으로 바로 넘어간다.

export const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const pad = (n: number) => String(n).padStart(2, "0");
const shortDateTime = (value: string) => { const d = new Date(value); return `${d.getMonth() + 1}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const broadcastTitle = (value: string) => {
  const date = new Date(value);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday}) ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const download = (bytes: Uint8Array, fileName: string) => {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const settlementErrorLabel = (error: { line: number; text: string }) => { const match = error.text.match(/^\s*@?([a-z0-9._]+)/i); return match?.[1] ? `@${match[1]}` : `${error.line}행`; };

const STATUS_CLASS: Record<OrderStatus, string> = { WAITING: "waiting", READY: "ready", COMPLETED: "shipped" };
export function StatusPill({ status }: { status: OrderStatus }) { return <span className={`gbx-pill ${STATUS_CLASS[status]}`}>{statusLabels[status]}</span>; }
/** 차단 = 빨간 바탕, 체크 이력 있음 = 주황 테두리, 정상 = 회색 */
export function CustomerPill({ customer }: { customer: Customer }) {
  const tone = customer.blocked ? "overdue" : customerCheckCount(customer) ? "tracking" : "shipped";
  return <span className={`gbx-pill ${tone}`}>{customerStatusLabel(customer)}</span>;
}

/** 주문서가 들어온 주문 중 고칠 게 남은 것만 "검토 필요"로 본다. */
const needsReview = (broadcast: Broadcast, order: Order) => Boolean(order.sourceText) && orderIssues(broadcast, order).length > 0;
/** 이 방송 날짜 이후에 체크된 고객의 입금 전 주문. 상태는 입금 전 그대로 두고 표시만 바꾼다. */
const broadcastDay = (broadcast: Broadcast) => new Date(broadcast.createdAt).toLocaleDateString("en-CA");
export const checkedInBroadcast = (customer: Customer | undefined, broadcast: Broadcast, order: Order) =>
  order.status === "WAITING" && Boolean(customer?.checkHistory?.some((check) => (check.date ?? "") >= broadcastDay(broadcast)));

/** 과거 배송정보로 채워진 주문은 입금만 확인하면 출력 대기로 간다. */
const confirmable = (broadcast: Broadcast, order: Order) => order.status === "WAITING" && !order.registrationConfirmed && Boolean(order.delivery) && orderIssues(broadcast, order).length === 0;

export const broadcastsV2Path = (basePath: string, broadcastId?: string) => broadcastId ? `${basePath}/broadcasts/${encodeURIComponent(broadcastId)}` : basePath || "/";

// ── 목록 ─────────────────────────────────────────────────

function BroadcastListV2({ basePath }: { basePath: string }) {
  const { state, commit } = useDashboard();
  const router = useRouter();
  const broadcasts = [...state.broadcasts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function create() {
    let broadcastId = "";
    const saved = commit((current) => { const result = addBroadcast(current, `방송 ${broadcastTitle(new Date().toISOString())}`); broadcastId = result.broadcastId; return result.state; }, "새 방송을 만들었습니다.");
    if (saved) router.push(broadcastsV2Path(basePath, broadcastId));
  }
  return <>
    <header className="gbx-head"><h1>방송 내역</h1><button type="button" className="gbx-btn primary" onClick={create}><Plus />새 방송</button></header>
    {broadcasts.length ? <ul className="gbx-list">{broadcasts.map((broadcast) => {
      const count = (status: OrderStatus) => broadcast.orders.filter((order) => order.status === status).length;
      const waiting = count("WAITING");
      const review = broadcast.orders.filter((order) => needsReview(broadcast, order)).length;
      return <li key={broadcast.id}>
        <Link href={broadcastsV2Path(basePath, broadcast.id)} className="gbx-list-row gbx-bc-row">
          <div className="gbx-list-main">
            <div><strong>{broadcast.title}</strong>{review ? <span className="gbx-pill waiting">검토 {review}</span> : null}</div>
          </div>
          <dl className="gbx-list-stats gbx-bc-stats">
            <div><dt>주문</dt><dd>{broadcast.orders.length}</dd></div>
            <div><dt>입금 전</dt><dd className={waiting ? "red" : ""}>{waiting}</dd></div>
            <div><dt>출력 대기</dt><dd>{count("READY")}</dd></div>
            <div><dt>출력 완료</dt><dd className="muted">{count("COMPLETED")}</dd></div>
          </dl>
          <ChevronRight className="gbx-list-arrow" />
        </Link>
      </li>;
    })}</ul> : <div className="gbx-empty"><strong>아직 생성한 방송이 없어요.</strong><p>새 방송을 만들면 정산과 주문을 관리할 수 있어요.</p><button type="button" className="gbx-btn primary" onClick={create}><Plus />새 방송</button></div>}
  </>;
}

// ── 상세 ─────────────────────────────────────────────────

type View = "ALL" | OrderStatus | "ISSUES";

function EditableTitle({ broadcast }: { broadcast: Broadcast }) {
  const { commit } = useDashboard();
  const [draft, setDraft] = useState(broadcast.title);
  useEffect(() => setDraft(broadcast.title), [broadcast.id, broadcast.title]);
  function save() { if (draft === broadcast.title) return; if (!commit((current) => renameBroadcast(current, broadcast.id, draft), "방송 이름을 수정했습니다.")) setDraft(broadcast.title); }
  return <input className="gbx-bc-title" aria-label="방송 이름" title="눌러서 이름 바꾸기" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(broadcast.title); e.currentTarget.blur(); } }} />;
}

function BroadcastDetailV2({ broadcastId, basePath }: { broadcastId: string; basePath: string }) {
  const { state, commit, notify } = useDashboard();
  const router = useRouter();
  const settlementRef = useRef<HTMLTextAreaElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const broadcast = state.broadcasts.find((item) => item.id === broadcastId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key !== "/" || openId || orderOpen || isTyping(event.target)) return; event.preventDefault(); searchRef.current?.focus(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, orderOpen]);

  const list = useMemo(() => {
    if (!broadcast) return [];
    const q = query.trim().toLowerCase();
    return broadcast.orders.filter((order) => (view === "ALL" || (view === "ISSUES" ? needsReview(broadcast, order) : order.status === view))
      && (!q || order.instagramId.toLowerCase().includes(q) || Boolean(order.delivery?.name.includes(query.trim()))));
  }, [broadcast, view, query]);

  if (!broadcast) return <div className="gbx-empty"><strong>방송 작업을 찾을 수 없어요.</strong><Link href={broadcastsV2Path(basePath)}>방송 목록으로</Link></div>;
  const current = broadcast;
  const counts: Record<View, number> = {
    ALL: current.orders.length,
    WAITING: current.orders.filter((o) => o.status === "WAITING").length,
    READY: current.orders.filter((o) => o.status === "READY").length,
    COMPLETED: current.orders.filter((o) => o.status === "COMPLETED").length,
    ISSUES: current.orders.filter((o) => needsReview(current, o)).length,
  };
  const totalAmount = current.settlements.reduce((sum, settlement) => sum + settlement.total, 0);
  const analysis = analyzeSettlement(current.memo);
  const announcement = analysis.announcement;
  const unsaved = current.memoDraft !== current.memo;
  const ids = list.map((order) => order.id);

  function selectSettlementError(error: { line: number; text: string }) {
    const field = settlementRef.current;
    if (!field) return;
    const lines = current.memoDraft.split(/\r?\n/);
    const start = lines.slice(0, error.line - 1).reduce((length, line) => length + line.length + 1, 0);
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus();
    field.setSelectionRange(start, start + (lines[error.line - 1] ?? error.text).length);
    const lineHeight = Number.parseFloat(window.getComputedStyle(field).lineHeight) || 20;
    field.scrollTop = Math.max(0, (error.line - 2) * lineHeight);
  }
  function runSettlement() {
    const errors = analyzeSettlement(current.memoDraft).errors;
    const saved = commit((state) => saveSettlement(state, current.id, current.memoDraft), current.memoDraft.trim() ? "정산 내용을 분석했습니다." : "정산 입력을 비웠습니다.");
    if (saved && errors[0]) window.requestAnimationFrame(() => selectSettlementError(errors[0]));
  }
  function runOrder() {
    let orderId = "";
    const ok = commit((state) => { const result = registerOrder(state, current.id, current.orderDraft); orderId = result.orderId; return saveDraft(result.state, current.id, "orderDraft", ""); }, "주문서를 등록했습니다.");
    if (ok) { setOrderOpen(false); setOpenId(orderId); }
  }
  const runExport = () => commit((state) => exportReadyOrders(state, current.id, download), `${counts.READY}건의 XLSX를 만들고 출력 완료로 이동했습니다.`);
  function remove() { if (commit((state) => deleteBroadcast(state, current.id), "방송을 삭제했습니다.")) router.push(broadcastsV2Path(basePath)); }
  const changeView = (next: View) => setView(view === next ? "ALL" : next);
  const copyAnnouncement = () => navigator.clipboard.writeText(announcement).then(() => notify("공지 텍스트를 복사했습니다.")).catch(() => notify("클립보드에 접근하지 못했습니다.", true));

  return <>
    <nav className="gbx-crumb"><Link href={broadcastsV2Path(basePath)}>방송 내역</Link><ChevronRight /><span>{current.title}</span></nav>
    <header className="gbx-head detail">
      <div className="gbx-bc-headline">
        <EditableTitle broadcast={current} />
        <p className="gbx-meta">{broadcastTitle(current.createdAt)} 방송 · 수정 {shortDateTime(current.updatedAt)} · 정산 {current.settlements.length}건 · 정산 금액 <b className="red">{won(totalAmount)}</b></p>
      </div>
    </header>

    <section className="gbx-bc-settle" aria-label="정산">
      <div className="gbx-bc-settle-col">
        <div className="gbx-bc-settle-head"><h2><label htmlFor="settlement">정산 주문 입력</label></h2>{unsaved ? <span className="gbx-bc-dirty">분석 전</span> : null}</div>
        <textarea ref={settlementRef} id="settlement" value={current.memoDraft} onChange={(event) => commit((state) => saveDraft(state, current.id, "memoDraft", event.target.value))} placeholder="정산할 주문 내용을 붙여넣어 주세요." spellCheck={false} />
        <button type="button" className={`gbx-btn ${unsaved ? "primary" : ""}`} onClick={runSettlement}>정산 분석 실행</button>
      </div>
      <div className="gbx-bc-settle-col">
        <div className="gbx-bc-settle-head"><h2>공지용 정산 텍스트</h2><button type="button" className="gbx-link" disabled={!announcement} onClick={copyAnnouncement}><Copy />복사</button></div>
        <pre className={announcement ? "" : "empty"}>{announcement || "분석을 실행하면 공지용 정산 안내문이 여기에 표시됩니다."}</pre>
        {analysis.errors.length ? <div className="gbx-bc-errors"><span>정산 오류 {analysis.errors.length}건</span>{analysis.errors.map((error) => <button key={`${error.line}-${error.text}`} type="button" title="입력에서 보기" onClick={() => selectSettlementError(error)}>{settlementErrorLabel(error)}</button>)}</div> : null}
      </div>
    </section>

    <div className="gbx-toolbar">
      <label className="gbx-search"><Search /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="아이디 또는 성명 검색" aria-label="주문 검색" />{query ? <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button> : <kbd>/</kbd>}</label>
      <div className="gbx-toolbar-actions">
        <button type="button" className="gbx-btn" onClick={() => setOrderOpen(true)}><Plus />신규 주문서 등록</button>
        <button type="button" className="gbx-btn primary" disabled={!counts.READY} onClick={runExport}><Download />출력 대기 엑셀 출력 <b>{counts.READY}</b></button>
      </div>
    </div>
    <div className="gbx-filters">
      <div className="gbx-chips" role="tablist" aria-label="주문 상태">{([["ALL", "전체"], ["WAITING", "입금 전"], ["READY", "출력 대기"], ["COMPLETED", "완료"], ["ISSUES", "검토 필요"]] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={view === key} className={`${view === key ? "active" : ""} ${key === "ISSUES" && counts.ISSUES ? "warn" : ""}`} onClick={() => setView(key)}>{label}<b>{counts[key]}</b></button>)}</div>
    </div>

    <div className="gbx-table-wrap">
      <table className="gbx-table gbx-bc-table">
        <colgroup><col className="c-id" /><col /><col className="c-amount" /><col className="c-qty" /><col className="c-stage" /><col className="c-act" /></colgroup>
        <thead><tr><th>인스타그램 아이디</th><th>받는분</th><th className="num">정산금액</th><th className="num">총 갯수</th><th>주문 상태</th><th className="act"><span className="sr-only">바로 처리</span></th></tr></thead>
        <tbody>{list.map((order) => {
          const settlement = current.settlements.find((item) => item.id === order.settlementId);
          const issues = order.sourceText || order.delivery ? orderIssues(current, order) : [];
          const known = order.instagramId ? customerFor(state, order.instagramId) : undefined;
          const checked = checkedInBroadcast(known, current, order);
          return <tr key={order.id} className={openId === order.id ? "open" : ""} onClick={() => setOpenId(order.id)}>
            <td><strong>{order.instagramId || "아이디 미인식"}</strong>{known && (known.blocked || customerCheckCount(known)) ? <small className="red">{customerStatusLabel(known)}</small> : null}</td>
            <td>{order.delivery ? <><strong>{order.delivery.name || "성명 누락"}</strong><small>{order.delivery.phone || "연락처 누락"}</small></> : <span className="gbx-muted">주문서 미등록</span>}</td>
            <td className="num">{settlement ? <><strong>{won(settlement.total)}</strong>{settlement.items.length ? <small className="gbx-bc-lines" title={settlement.items.join("\n")}>{settlement.items.join(" · ")}</small> : null}</> : <span className="gbx-muted">—</span>}</td>
            <td className="num">{settlement ? `${settlement.quantity}개` : <span className="gbx-muted">—</span>}</td>
            <td>{checked ? <span className="gbx-pill tracking" title="입금 전 주문이에요. 이 방송에서 체크했어요.">체크</span> : <StatusPill status={order.status} />}{!checked && issues.length && order.status !== "COMPLETED" ? <small className="red" title={issues.map((issue) => issue.message).join("\n")}>{issues[0].message}{issues.length > 1 ? ` 외 ${issues.length - 1}` : ""}</small> : null}</td>
            <td className="act" onClick={(e) => e.stopPropagation()}>{confirmable(current, order)
              ? <button type="button" className="gbx-btn xs" onClick={() => commit((state) => confirmPreviousInfo(state, current.id, order.id), "입금을 확인하고 출력 대기로 이동했습니다.")}><Check />입금 확인</button>
              : <ChevronRight className="gbx-row-arrow" onClick={() => setOpenId(order.id)} />}</td>
          </tr>;
        })}</tbody>
      </table>
      {!list.length ? <div className="gbx-empty-row">{query ? <>‘{query}’에 맞는 주문이 없어요. <button type="button" onClick={() => setQuery("")}>검색어 지우기</button></> : current.orders.length ? "조건에 맞는 주문이 없어요." : "정산 주문을 분석하면 주문 목록이 여기에 표시돼요."}</div> : null}
    </div>

    <div className="gbs-danger gbx-bc-danger">
      {deleting ? <>
        <p><b>이 방송을 삭제할까요?</b> 방송에 포함된 정산과 주문도 함께 삭제되며 되돌릴 수 없어요.</p>
        <div><button type="button" className="gbx-btn ghost sm" onClick={() => setDeleting(false)}>취소</button><button type="button" className="gbx-btn danger sm" onClick={remove}>방송 삭제</button></div>
      </> : <button type="button" className="gbx-link muted" onClick={() => setDeleting(true)}>이 방송 삭제</button>}
    </div>

    {orderOpen ? <Modal title="신규 주문서 등록" description="카카오톡 주문서 내용을 그대로 붙여넣어 주세요." onClose={() => setOrderOpen(false)}
      footer={<><button type="button" className="gbx-btn ghost" onClick={() => setOrderOpen(false)}>취소</button><button type="button" className="gbx-btn primary" disabled={!current.orderDraft.trim()} onClick={runOrder}>주문서 등록</button></>}>
      <textarea className="gbx-bc-order-input" autoFocus value={current.orderDraft} onChange={(event) => commit((state) => saveDraft(state, current.id, "orderDraft", event.target.value))} placeholder={"인스타 아이디: sample.user\n성함: 홍길동\n주소: 서울시 ...\n연락처: 01000000000"} />
    </Modal> : null}
    {openId ? <OrderPanelV2 key={openId} broadcast={current} orderId={openId} ids={ids} onNavigate={setOpenId} onClose={() => setOpenId(null)} /> : null}
  </>;
}

// ── 주문 패널 ────────────────────────────────────────────

function OrderPanelV2({ broadcast, orderId, ids, onNavigate, onClose }: { broadcast: Broadcast; orderId: string; ids: string[]; onNavigate: (id: string) => void; onClose: () => void }) {
  const { state, commit } = useDashboard();
  const order = broadcast.orders.find((item) => item.id === orderId);
  const [frozenIds] = useState(ids);
  const index = frozenIds.indexOf(orderId);
  const prevId = index > 0 ? frozenIds[index - 1] : null;
  const nextId = index >= 0 && index < frozenIds.length - 1 ? frozenIds[index + 1] : null;
  const [delivery, setDelivery] = useState<Delivery>(order?.delivery ?? { name: "", address: "", phone: "" });
  const [instagramId, setInstagramId] = useState(order?.instagramId ?? "");
  const [shippingMessage, setShippingMessage] = useState(order?.shippingMessage ?? "");
  const [matchQuery, setMatchQuery] = useState("");
  useEffect(() => { if (!order) return; setDelivery(order.delivery ?? { name: "", address: "", phone: "" }); setInstagramId(order.instagramId); setShippingMessage(order.shippingMessage ?? ""); setMatchQuery(""); }, [order?.id, order?.delivery, order?.instagramId, order?.shippingMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (isTyping(event.target)) return;
      if ((event.key === "ArrowDown" || event.key === "j") && nextId) { event.preventDefault(); onNavigate(nextId); }
      if ((event.key === "ArrowUp" || event.key === "k") && prevId) { event.preventDefault(); onNavigate(prevId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextId, prevId, onClose, onNavigate]);

  if (!order) return null;
  const settlement = broadcast.settlements.find((item) => item.id === order.settlementId);
  const candidates = matchingCandidates(broadcast, order);
  const issues = orderIssues(broadcast, order);
  const editable = order.status !== "COMPLETED";
  const selectedSettlement = broadcast.settlements.find((item) => item.instagramId.toLowerCase() === matchQuery.trim().replace(/^@/, "").toLowerCase());
  const dirty = instagramId !== order.instagramId || shippingMessage !== (order.shippingMessage ?? "") || JSON.stringify(delivery) !== JSON.stringify(order.delivery ?? { name: "", address: "", phone: "" });
  const save = () => commit((state) => editOrder(state, broadcast.id, order.id, delivery, instagramId, shippingMessage), order.status === "READY" ? "출력 대기 주문 정보를 수정했습니다." : "주문 정보를 저장했습니다.");
  const goNextOrClose = () => { if (nextId) onNavigate(nextId); else onClose(); };
  const fieldIssues = deliveryIssues(delivery);

  return <div className="gbx-panel-layer">
    <div className="gbx-panel-dim" onClick={onClose} aria-hidden="true" />
    <aside className="gbx-panel" role="dialog" aria-modal="true" aria-label={`주문 ${order.instagramId}`}>
      <header className="gbx-panel-head">
        <div><span className="gbx-mono">@{order.instagramId || "아이디 미인식"}</span>{checkedInBroadcast(order.instagramId ? customerFor(state, order.instagramId) : undefined, broadcast, order) ? <span className="gbx-pill tracking">체크</span> : <StatusPill status={order.status} />}</div>
        <div className="gbx-panel-nav">
          {index >= 0 ? <span>{index + 1} / {frozenIds.length}</span> : null}
          <button type="button" className="gbx-icon-btn" aria-label="이전 주문 (↑)" title="이전 주문 (↑)" disabled={!prevId} onClick={() => prevId && onNavigate(prevId)}><ChevronLeft className="up" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="다음 주문 (↓)" title="다음 주문 (↓)" disabled={!nextId} onClick={() => nextId && onNavigate(nextId)}><ChevronRight className="down" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}><X /></button>
        </div>
      </header>

      <div className="gbx-panel-body">
        <section className="gbx-hero">
          <div><small>정산금액</small><strong className="red">{settlement ? won(settlement.total) : "—"}</strong></div>
          <div><small>총 갯수</small><strong>{settlement ? `${settlement.quantity}개` : "—"}</strong></div>
          <p>{settlement ? "정산 주문 연결됨" : "정산 미연결"}{order.sourceText ? " · 주문서 등록됨" : order.delivery ? " · 저장된 배송정보 사용" : " · 주문서 미등록"}</p>
        </section>

        {issues.length ? <div className="gbx-warn gbx-bc-issues"><b>검토할 항목 {issues.length}개</b>{issues.map((issue, i) => <span key={`${issue.code}-${i}`}>{issue.message}</span>)}</div> : null}

        {settlement?.items.length ? <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>정산 품목</h3></div>
          <ul className="gbx-bc-items">{settlement.items.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}</ul>
        </section> : null}

        {!order.settlementId ? <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>정산 주문 연결</h3><span className="gbx-help">유사 후보는 자동 확정하지 않아요</span></div>
          {candidates.length ? <div className="gbx-bc-candidates">{candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => commit((state) => matchOrder(state, broadcast.id, order.id, candidate.id), `${candidate.instagramId} 정산 주문에 연결했습니다.`)}>@{candidate.instagramId}<small>{won(candidate.total)}</small></button>)}</div> : null}
          <div className="gbx-inline">
            <input list={`settlement-options-${order.id}`} value={matchQuery} onChange={(event) => setMatchQuery(event.target.value)} placeholder="정산 아이디 검색" aria-label="정산 주문 검색" />
            <datalist id={`settlement-options-${order.id}`}>{broadcast.settlements.map((item) => <option key={item.id} value={item.instagramId} label={`${won(item.total)} · ${item.quantity}개`} />)}</datalist>
            <button type="button" className="gbx-btn" disabled={!selectedSettlement} onClick={() => selectedSettlement && commit((state) => matchOrder(state, broadcast.id, order.id, selectedSettlement.id), "정산 주문을 연결했습니다.")}>연결</button>
          </div>
        </section> : null}

        {order.conflict ? <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>고객 정보가 달라요</h3><span className="gbx-help">이번 주문에 쓸 정보를 고르세요</span></div>
          <div className="gbx-bc-conflict">
            {([["previous", "저장된 정보", "저장된 정보 사용", "저장된 고객정보로 출력 대기 상태가 되었습니다."], ["incoming", "신규 주문서", "신규 정보 적용", "신규 고객정보를 적용하고 출력 대기 상태가 되었습니다."]] as const).map(([key, label, action, message]) => {
              const info = order.conflict![key];
              return <article key={key} className={key}>
                <span>{label}</span><strong>{info.name}</strong><p>{info.address}</p><p>{info.phone}</p>
                <button type="button" className={`gbx-btn sm ${key === "incoming" ? "primary" : ""}`} onClick={() => commit((state) => resolveConflict(state, broadcast.id, order.id, key), message)}>{action}</button>
              </article>;
            })}
          </div>
        </section> : null}

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>주문 정보</h3><span className="gbx-help">{order.status === "READY" ? "출력 대기 상태에서도 수정할 수 있어요" : order.status === "COMPLETED" ? "재출력하려면 출력 대기로 되돌리세요" : "누락된 정보를 채우면 자동으로 출력 대기가 돼요"}</span></div>
          <div className="gbx-form">
            <label>인스타그램 아이디<input value={instagramId} disabled={!editable} onChange={(e) => setInstagramId(e.target.value)} placeholder="instagram_id" /></label>
            <label>받는분 성명<input value={delivery.name} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, name: e.target.value })} /></label>
            <label className="full">주소<input value={delivery.address} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></label>
            <label>연락처<input value={delivery.phone} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} placeholder="010-0000-0000" /></label>
            <label className="full">배송 메시지<input value={shippingMessage} disabled={!editable} onChange={(e) => setShippingMessage(e.target.value)} placeholder="예: 문 앞에 놓아주세요" /></label>
          </div>
          {editable && fieldIssues.length ? <p className="gbx-bc-field-issues">{fieldIssues.map((issue) => issue.message).join(" · ")}</p> : null}
          {editable ? <div className="gbx-sec-actions"><button type="button" className="gbx-btn primary" disabled={!dirty && order.registrationConfirmed} onClick={save}>저장</button></div> : null}
        </section>

        <CustomerCheckSection instagramId={order.instagramId} />

        {order.sourceText ? <details className="gbx-fold">
          <summary>받은 주문서 원문<ChevronDown /></summary>
          <pre className="gbx-bc-source">{order.sourceText}</pre>
        </details> : null}
      </div>

      <footer className="gbx-panel-foot">
        {order.status === "WAITING" && !order.registrationConfirmed && order.delivery
          ? <button type="button" className="gbx-btn primary wide" onClick={() => { if (commit((state) => confirmPreviousInfo(state, broadcast.id, order.id), "입금을 확인하고 출력 대기로 이동했습니다.")) goNextOrClose(); }}><Check />입금 확인{nextId ? " · 다음 주문" : ""}</button>
          : order.status === "COMPLETED"
            ? <><span className="gbx-foot-note">택배 엑셀로 내보낸 주문이에요</span><button type="button" className="gbx-btn" onClick={() => commit((state) => restoreOrder(state, broadcast.id, order.id), "출력 대기로 되돌렸습니다.")}>출력 대기로 되돌리기</button></>
            : order.status === "READY"
              ? <span className="gbx-foot-note">배송정보 확인됨 · 다음 택배 엑셀에 들어가요</span>
              : <span className="gbx-foot-note">{order.delivery ? "필수 정보와 연결 문제를 먼저 고쳐 주세요" : "주문서를 받으면 배송정보가 채워져요"}</span>}
      </footer>
    </aside>
  </div>;
}

/**
 * 주문서를 안 쓴 사람도 아이디만으로 체크·차단해 두면 다음 방송에서 이어서 볼 수 있다.
 * 고객이 없으면 체크·차단하는 순간 아이디만 있는 고객으로 저장된다.
 */
function CustomerCheckSection({ instagramId }: { instagramId: string }) {
  const { state, commit } = useDashboard();
  const [draft, setDraft] = useState<{ date: string; note: string } | null>(null);
  const customer = instagramId ? customerFor(state, instagramId) : undefined;
  if (!instagramId) return null;
  const withCustomer = (change: (state: ReturnType<typeof ensureCustomer>["state"], customerId: string) => ReturnType<typeof ensureCustomer>["state"]) =>
    (current: ReturnType<typeof ensureCustomer>["state"]) => { const ensured = ensureCustomer(current, instagramId); return change(ensured.state, ensured.customerId); };
  function saveCheck() {
    if (!draft) return;
    if (commit(withCustomer((next, id) => addCustomerCheck(next, id, draft.date, draft.note)), "체크 이력을 추가했습니다.")) setDraft(null);
  }
  const recent = [...(customer?.checkHistory ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 2);
  return <section className="gbx-sec">
    <div className="gbx-sec-head"><h3>고객 체크</h3>{customer ? <CustomerPill customer={customer} /> : <span className="gbx-help">저장된 고객 아님</span>}</div>
    {recent.length || (customer?.legacyCheckCount ?? 0) ? <ul className="gbx-bc-checks">
      {recent.map((check) => <li key={check.id}><b>{check.date ?? "일자 미상"}</b>{check.note || "메모 없음"}</li>)}
      {(customer?.legacyCheckCount ?? 0) > 0 ? <li><b>기존 누적</b>{customer!.legacyCheckCount}회</li> : null}
    </ul> : null}
    {draft ? <div className="gbx-cu-check-form">
      <div className="gbx-form">
        <label>체크 날짜<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        <label className="full">메모 <span className="gbx-help">선택</span><input value={draft.note} autoFocus onChange={(e) => setDraft({ ...draft, note: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveCheck(); }} placeholder="예: 주문서 미작성 · 연락 없음" /></label>
      </div>
      <div className="gbx-sec-actions"><button type="button" className="gbx-btn ghost sm" onClick={() => setDraft(null)}>취소</button><button type="button" className="gbx-btn primary sm" onClick={saveCheck}>체크 추가</button></div>
    </div> : <div className="gbx-sec-actions start">
      <button type="button" className="gbx-btn sm" onClick={() => setDraft({ date: new Date().toLocaleDateString("en-CA"), note: "" })}>체크 추가</button>
      <button type="button" className={`gbx-btn sm ${customer?.blocked ? "" : "ghost"}`} onClick={() => commit(withCustomer((next, id) => setCustomerBlocked(next, id, !customer?.blocked)), customer?.blocked ? "고객 차단을 해제했습니다." : "고객을 차단했습니다.")}>{customer?.blocked ? "차단 해제" : "차단하기"}</button>
    </div>}
    {!customer ? <p className="gbx-help gbx-bc-check-note">체크하거나 차단하면 아이디만으로 고객 관리에 저장돼요. 다음 방송에서 같은 아이디가 오면 이어서 보여요.</p> : null}
  </section>;
}

// ── 진입점 ───────────────────────────────────────────────

export default function BroadcastsV2({ basePath = "", broadcastId }: { basePath?: string; broadcastId?: string }) {
  return <Shell section="broadcasts" basePath={basePath}>
    <div className="gbx gbx-bc">
      {broadcastId ? <BroadcastDetailV2 broadcastId={broadcastId} basePath={basePath} /> : <BroadcastListV2 basePath={basePath} />}
    </div>
  </Shell>;
}

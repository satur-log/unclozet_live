"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { takeDeletedGroupBuy, ToastContext, useCopy, useRun, type Toast } from "./admin-v2-shared";
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, CopyPlus, Download, Link2, MessageSquareText, Plus, RotateCcw, Search, Truck, Upload, X } from "lucide-react";
import { Shell } from "../dashboard-v2/shell";
import {
  adjustStock, allOrdersWorkbook, cancelOrder, confirmPayments, COURIERS, createGroupBuy, differenceSmsText, duplicateGroupBuy, editOrderDelivery, editOrderItems, exportReadyOrders,
  groupBuyStatusLabels, paymentGuideText, reexportOrders, resetLookupPin, restoreGroupBuy, revertPayment, setSellerNote, setTracking, smsHref, statusLabels, stockReport,
  GroupBuyError, readyItemsReport, setSoldOut, trackingUrl, type DeliveryFields, type ReadyItemRow, type StockRow,
} from "./model";
import { ManualOrderV2, TrackingImportV2 } from "./dialogs-v2";
import { SettingsV2 } from "./settings-v2";
import { priceCart } from "./pricing";
import { remoteAreaLabel, remoteAreaOf } from "./remote-area";
import { resetGroupBuyState, updateGroupBuyState, useGroupBuyState } from "./store";
import type { GbOrder, GbProduct, GroupBuy, GroupBuyState } from "./types";
import { absoluteUrl, adminPath, CartPicker, cartLines, dateTime, downloadBytes, longDateTime, lookupPath, orderFormPath, orderViewPath, ProductThumb, type Cart, won } from "./ui";
import { axesFor } from "./variants";
import "./group-buy.css";
import "./admin-v2.css";

// 공구 관리 v2 — 고객 상세페이지와 같은 결(흰 바탕·얇은 선·검정 버튼·빨간 금액)로 다시 짠 관리자 화면.
// 하루 일과(입금 확인 → 택배 엑셀 → 송장 등록)를 화면 맨 위 흐름으로 보여주고, 주문 패널에서 다음 주문으로 바로 넘어간다.

// ── 공통 조각 ────────────────────────────────────────────

type Stage = "waiting" | "ready" | "tracking" | "shipped" | "cancelled";
/** 출력 완료를 송장 유무로 나눠, 판매자가 "다음에 할 일" 기준으로 볼 수 있게 한다. */
function stageOf(order: GbOrder): Stage {
  if (order.cancelledAt) return "cancelled";
  if (order.status === "WAITING") return "waiting";
  if (order.status === "READY") return "ready";
  return order.trackingNo ? "shipped" : "tracking";
}
const STAGE_LABEL: Record<Stage, string> = { waiting: "입금 대기", ready: "출력 대기", tracking: "송장 대기", shipped: "발송 완료", cancelled: "취소" };

/** 입금 기한이 지난 입금 대기는 같은 글자에 빨간 바탕으로 구분한다. */
function StagePill({ stage, late = false }: { stage: Stage; late?: boolean }) {
  return <span className={`gbx-pill ${stage} ${late ? "overdue" : ""}`}>{STAGE_LABEL[stage]}</span>;
}

function StatusPill({ status }: { status: GroupBuy["status"] }) {
  return <span className={`gbx-pill gb-${status}`}>{groupBuyStatusLabels[status]}</span>;
}

function dday(groupBuy: GroupBuy, now: Date) {
  if (groupBuy.status === "draft") return "준비 중";
  const ms = new Date(groupBuy.closesAt).getTime() - now.getTime();
  if (groupBuy.status === "closed" || ms <= 0) return "마감됨";
  if (now < new Date(groupBuy.opensAt)) return "오픈 전";
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `마감 D-${days}` : `마감 ${Math.max(1, Math.floor(ms / 3_600_000))}시간 전`;
}
const shortDate = (value: string) => { const d = new Date(value); return `${d.getMonth() + 1}.${d.getDate()}`; };

function ProtoNote() {
  const toast = useContext(ToastContext);
  const [confirming, setConfirming] = useState(false);
  return <p className="gbx-proto">프로토타입 · 이 브라우저에만 저장돼요
    {confirming ? <><button type="button" onClick={() => setConfirming(false)}>취소</button><button type="button" className="danger" onClick={() => { resetGroupBuyState(); setConfirming(false); toast({ message: "데모 데이터로 초기화했어요." }); }}>초기화 확정</button></>
      : <button type="button" onClick={() => setConfirming(true)}><RotateCcw />데모 데이터로 초기화</button>}
  </p>;
}

// ── 공구 목록 ────────────────────────────────────────────

function ListPage({ state }: { state: GroupBuyState }) {
  const run = useRun();
  const copy = useCopy();
  const router = useRouter();
  const now = new Date();
  function create() { let id = ""; if (run((current) => { const result = createGroupBuy(current); id = result.groupBuyId; return result.state; }, "새 공구를 만들었어요. 설정을 채워주세요.")) router.push(`${adminPath(id)}?tab=settings`); }
  function duplicate(groupBuyId: string) { let id = ""; if (run((current) => { const result = duplicateGroupBuy(current, groupBuyId); id = result.groupBuyId; return result.state; }, "상품·옵션을 복제했어요.")) router.push(`${adminPath(id)}?tab=settings`); }
  const groupBuys = [...state.groupBuys].sort((a, b) => (a.status === "closed" ? 1 : 0) - (b.status === "closed" ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));

  return <>
    <header className="gbx-head">
      <h1>공구</h1>
      <button type="button" className="gbx-btn primary" onClick={create}><Plus />새 공구</button>
    </header>
    <ul className="gbx-list">{groupBuys.map((groupBuy) => {
      const orders = state.orders.filter((order) => order.groupBuyId === groupBuy.id && !order.cancelledAt);
      const waiting = orders.filter((order) => order.status === "WAITING").length;
      const ready = orders.filter((order) => order.status === "READY").length;
      const low = stockReport(state, groupBuy).filter((row) => row.shortage > 0).length;
      const cover = groupBuy.products[0]?.images[0] ?? "";
      return <li key={groupBuy.id}>
        <Link href={adminPath(groupBuy.id)} className="gbx-list-row">
          {cover ? <img src={cover} alt="" /> : <ProductThumb name={groupBuy.title} imageUrl="" size={64} />}
          <div className="gbx-list-main">
            <div><StatusPill status={groupBuy.status} /><strong>{groupBuy.title}</strong></div>
            <span>{shortDate(groupBuy.opensAt)} – {shortDate(groupBuy.closesAt)} · {dday(groupBuy, now)}</span>
          </div>
          <dl className="gbx-list-stats">
            <div><dt>주문</dt><dd>{orders.length}</dd></div>
            <div><dt>입금 대기</dt><dd className={waiting ? "red" : ""}>{waiting}</dd></div>
            <div><dt>출력 대기</dt><dd>{ready}</dd></div>
            <div><dt>재고</dt><dd className={low ? "red" : "muted"}>{low ? `부족 ${low}` : "여유"}</dd></div>
          </dl>
          <ChevronRight className="gbx-list-arrow" />
        </Link>
        <div className="gbx-list-actions">
          <button type="button" className="gbx-icon-btn" title="주문서 링크 복사" aria-label={`${groupBuy.title} 주문서 링크 복사`} onClick={() => copy(absoluteUrl(orderFormPath(groupBuy.slug)), "주문서 링크")}><Link2 /></button>
          <button type="button" className="gbx-icon-btn" title="상품·옵션 그대로 복제" aria-label={`${groupBuy.title} 복제`} onClick={() => duplicate(groupBuy.id)}><CopyPlus /></button>
        </div>
      </li>;
    })}</ul>
    {!groupBuys.length ? <div className="gbx-empty"><strong>아직 만든 공구가 없어요.</strong><button type="button" className="gbx-btn primary" onClick={create}><Plus />새 공구</button></div> : null}
    <ProtoNote />
  </>;
}

// ── 공구 상세 ────────────────────────────────────────────

type Tab = "orders" | "stock" | "settings";

function DetailPage({ state, groupBuyId, initialTab }: { state: GroupBuyState; groupBuyId: string; initialTab: Tab }) {
  const copy = useCopy();
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (next: Tab) => { setTabState(next); window.history.replaceState(null, "", next === "orders" ? adminPath(groupBuyId) : `${adminPath(groupBuyId)}?tab=${next}`); };
  const groupBuy = state.groupBuys.find((item) => item.id === groupBuyId);
  if (!groupBuy) return <div className="gbx-empty"><strong>공구를 찾을 수 없어요.</strong><Link href={adminPath()}>공구 목록으로</Link></div>;
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuy.id);
  const live = orders.filter((order) => !order.cancelledAt);
  const low = stockReport(state, groupBuy).filter((row) => row.shortage > 0).length;
  const now = new Date();

  return <>
    <nav className="gbx-crumb"><Link href={adminPath()}>공구</Link><ChevronRight /><span>{groupBuy.title}</span></nav>
    <header className="gbx-head detail">
      <div>
        <div className="gbx-title"><StatusPill status={groupBuy.status} /><h1>{groupBuy.title}</h1></div>
        <p className="gbx-meta">{longDateTime(groupBuy.opensAt)} – {longDateTime(groupBuy.closesAt)} · <b>{dday(groupBuy, now)}</b> · 주문 {live.length}건 · 매출 <b className="red">{won(live.reduce((sum, order) => sum + order.total, 0))}</b></p>
      </div>
      <div className="gbx-head-actions">
        <button type="button" className="gbx-btn" onClick={() => copy(absoluteUrl(orderFormPath(groupBuy.slug)), "주문서 링크")}><Link2 />주문서 링크 복사</button>
        <a className="gbx-btn" href={`${orderFormPath(groupBuy.slug)}?preview=1`} target="_blank" rel="noreferrer">고객 화면<ArrowUpRight /></a>
      </div>
    </header>
    <nav className="gbx-tabs" role="tablist" aria-label="공구 메뉴">
      {([["orders", "주문", live.length], ["stock", "재고", low ? `부족 ${low}` : null], ["settings", "설정", null]] as const).map(([key, label, badge]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}{badge != null ? <small className={key === "stock" ? "red" : ""}>{badge}</small> : null}</button>)}
    </nav>
    {tab === "orders" ? <OrdersView state={state} groupBuy={groupBuy} /> : tab === "stock" ? <StockView state={state} groupBuy={groupBuy} /> : <SettingsV2 key={groupBuy.id} state={state} groupBuy={groupBuy} />}
    <ProtoNote />
  </>;
}

// ── 주문 ─────────────────────────────────────────────────

type View = "all" | Stage;
type Sort = "recent" | "oldest" | "depositor" | "amount";

function matchesQuery(order: GbOrder, raw: string) {
  const q = raw.trim().replace(/\s+/g, "");
  if (!q) return true;
  const digits = q.replace(/[^\d]/g, "");
  if (order.customerName.includes(q) || order.depositorName.includes(q) || order.recipientName.includes(q) || order.orderNo.toLowerCase().includes(q.toLowerCase())) return true;
  // 은행 앱에서 본 금액(54800, 54,800원)이나 전화번호 뒷자리로도 찾는다.
  if (digits.length >= 3 && String(order.total) === digits) return true;
  return digits.length >= 4 && order.phone.replace(/\D/g, "").endsWith(digits);
}

function OrdersView({ state, groupBuy }: { state: GroupBuyState; groupBuy: GroupBuy }) {
  const run = useRun();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = new Date();

  const orders = useMemo(() => state.orders.filter((order) => order.groupBuyId === groupBuy.id), [state.orders, groupBuy.id]);
  const byStage = (stage: Stage) => orders.filter((order) => stageOf(order) === stage);
  const counts: Record<View, number> = { all: orders.filter((o) => !o.cancelledAt).length, waiting: byStage("waiting").length, ready: byStage("ready").length, tracking: byStage("tracking").length, shipped: byStage("shipped").length, cancelled: byStage("cancelled").length };

  const list = orders
    .filter((order) => view === "all" ? !order.cancelledAt : stageOf(order) === view)
    .filter((order) => matchesQuery(order, query))
    .sort((a, b) => sort === "depositor" ? a.depositorName.localeCompare(b.depositorName, "ko") : sort === "amount" ? a.total - b.total : sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  const ids = list.map((order) => order.id);
  const chosen = orders.filter((order) => selected.has(order.id));
  const allChosen = list.length > 0 && list.every((order) => selected.has(order.id));

  function changeView(next: View) {
    setView(next); setSelected(new Set());
    // 입금 대기는 은행 앱과 대조하기 쉽게 입금자명 순이 기본
    setSort(next === "waiting" ? "depositor" : "recent");
  }
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function confirm(orderIds: string[]) {
    const ok = run((current) => confirmPayments(current, orderIds), `${orderIds.length}건 입금 확인 → 출력 대기`, (current) => orderIds.reduce((next, id) => revertPayment(next, id), current));
    if (ok) setSelected(new Set());
    return ok;
  }
  const exportReady = () => run((current) => exportReadyOrders(current, groupBuy.id, downloadBytes), `택배 엑셀 ${counts.ready}건을 내려받았어요. 송장 대기로 옮겼어요.`);
  const exportAll = () => { try { const { bytes, fileName } = allOrdersWorkbook(state, groupBuy.id); downloadBytes(bytes, fileName); } catch (error) { run(() => { throw error; }); } };

  // "/"로 검색창에 바로 들어간다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || openId || isTyping(event.target)) return;
      event.preventDefault(); searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const steps: { stage: Stage; label: string; hint: string; action?: React.ReactNode }[] = [
    { stage: "waiting", label: "입금 확인", hint: "은행 입금 내역과 대조", action: counts.waiting ? <button type="button" className="gbx-btn sm" onClick={() => { changeView("waiting"); searchRef.current?.focus(); }}>입금 대조하기</button> : null },
    { stage: "ready", label: "택배 엑셀 출력", hint: "입금 확인된 주문", action: <button type="button" className="gbx-btn sm primary" disabled={!counts.ready} onClick={exportReady}><Download />엑셀 출력</button> },
    { stage: "tracking", label: "송장 등록", hint: "택배사 송장 엑셀 올리기", action: <button type="button" className="gbx-btn sm" disabled={!counts.tracking} onClick={() => setTrackingOpen(true)}><Upload />송장 엑셀</button> },
    { stage: "shipped", label: "발송 완료", hint: "고객 조회에 송장 표시 중" },
  ];

  return <>
    <ol className="gbx-flow" aria-label="오늘 할 일">
      {steps.map((step, index) => <li key={step.stage} className={`${view === step.stage ? "active" : ""} ${counts[step.stage] && step.stage !== "shipped" ? "todo" : ""}`}>
        <button type="button" className="gbx-flow-main" onClick={() => changeView(view === step.stage ? "all" : step.stage)} aria-pressed={view === step.stage}>
          <span className="gbx-flow-label"><i>{index + 1}</i>{step.label}</span>
          <strong>{counts[step.stage]}<small>건</small></strong>
          <span className="gbx-flow-hint">{step.hint}</span>
        </button>
        {step.action ? <div className="gbx-flow-action">{step.action}</div> : null}
      </li>)}
    </ol>

    <div className="gbx-toolbar">
      <label className="gbx-search"><Search /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="입금자명 · 주문자 · 금액 · 주문번호 · 전화 뒷자리" aria-label="주문 검색" />{query ? <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button> : <kbd>/</kbd>}</label>
      <div className="gbx-toolbar-actions">
        <button type="button" className="gbx-btn" onClick={() => setManualOpen(true)}><Plus />수기 주문</button>
        <button type="button" className="gbx-btn" onClick={exportAll} title="정산·발주용 전체 주문 + 옵션별 집계"><Download />전체 엑셀</button>
      </div>
    </div>
    <div className="gbx-filters">
      <div className="gbx-chips" role="tablist" aria-label="주문 상태">{(["all", "waiting", "ready", "tracking", "shipped", "cancelled"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => changeView(key)}>{key === "all" ? "전체" : STAGE_LABEL[key]}<b>{counts[key]}</b></button>)}</div>
      <label className="gbx-sort">정렬<select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">최신순</option><option value="oldest">오래된순</option><option value="depositor">입금자명 가나다</option><option value="amount">금액순</option></select></label>
    </div>

    {view === "ready" && counts.ready ? <ReadyItemsPanel state={state} groupBuy={groupBuy} /> : null}

    <div className="gbx-table-wrap">
      <table className="gbx-table">
        {/* 열 폭을 고정해 탭(필터)을 바꿔도 열 위치가 움직이지 않게 한다. */}
        <colgroup><col className="c-check" /><col className="c-no" /><col className="c-who" /><col /><col className="c-amount" /><col className="c-stage" /><col className="c-act" /></colgroup>
        <thead><tr>
          <th className="check"><input type="checkbox" aria-label="보이는 주문 모두 선택" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(ids))} /></th>
          <th>주문</th><th>주문자 · 입금자</th><th>품목</th><th className="num">금액</th><th>상태</th><th className="act"><span className="sr-only">바로 처리</span></th>
        </tr></thead>
        <tbody>{list.map((order) => {
          const stage = stageOf(order);
          const area = remoteAreaOf(order.postcode, order.address);
          return <tr key={order.id} className={`${openId === order.id ? "open" : ""} ${selected.has(order.id) ? "chosen" : ""}`} onClick={() => setOpenId(order.id)}>
            <td className="check" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`${order.orderNo} 선택`} checked={selected.has(order.id)} onChange={() => toggle(order.id)} /></td>
            {/* 행 높이는 고정(품목 두 줄 기준)이라 탭을 바꿔도 행이 커졌다 작아졌다 하지 않는다. */}
            <td><span className="gbx-mono" title={order.orderNo}>#{order.orderNo.slice(-4)}</span><small>{dateTime(order.createdAt)}{order.source === "manual" ? " · 수기" : ""}</small></td>
            <td><strong>{order.customerName}</strong>{order.depositorName !== order.customerName ? <small>입금 {order.depositorName}</small> : null}</td>
            <td><ItemsCell order={order} /></td>
            <td className="num"><strong>{won(order.total)}</strong></td>
            <td><StagePill stage={stage} />{order.sellerNote ? <small>메모 있음</small> : null}</td>
            <td className="act" onClick={(e) => e.stopPropagation()}>{stage === "waiting" ? <button type="button" className="gbx-btn xs" onClick={() => confirm([order.id])}><Check />입금 확인</button> : stage === "tracking" ? <button type="button" className="gbx-btn xs ghost" onClick={() => setOpenId(order.id)}>송장 입력</button> : <ChevronRight className="gbx-row-arrow" />}</td>
          </tr>;
        })}</tbody>
      </table>
      {!list.length ? <div className="gbx-empty-row">{query ? <>‘{query}’에 맞는 주문이 없어요. <button type="button" onClick={() => setQuery("")}>검색어 지우기</button></> : view === "waiting" ? "입금 대기 주문이 없어요. 👏" : orders.length ? "이 상태의 주문이 없어요." : "아직 들어온 주문이 없어요. 주문서 링크를 블로그에 걸어보세요."}</div> : null}
    </div>

    {chosen.length ? <div className="gbx-bulk" role="region" aria-label="선택한 주문">
      <span><b>{chosen.length}건</b> 선택 · {won(chosen.reduce((sum, order) => sum + order.total, 0))}</span>
      {chosen.every((order) => stageOf(order) === "waiting") ? <button type="button" className="gbx-btn primary" onClick={() => confirm(chosen.map((order) => order.id))}><Check />입금 확인</button> : null}
      {chosen.every((order) => stageOf(order) === "tracking" || stageOf(order) === "shipped") ? <button type="button" className="gbx-btn" onClick={() => { if (run((current) => reexportOrders(current, groupBuy.id, chosen.map((order) => order.id), downloadBytes), `${chosen.length}건 택배 엑셀을 다시 내려받았어요.`)) setSelected(new Set()); }}><Download />엑셀 재출력</button> : null}
      {!chosen.every((order) => stageOf(order) === "waiting") && !chosen.every((order) => stageOf(order) === "tracking" || stageOf(order) === "shipped") ? <span className="gbx-bulk-note">같은 상태끼리 고르면 한 번에 처리할 수 있어요</span> : null}
      <button type="button" className="gbx-btn ghost" onClick={() => setSelected(new Set())}>선택 해제</button>
    </div> : null}

    {openId ? <OrderPanel key={openId} state={state} groupBuy={groupBuy} orderId={openId} ids={ids} onNavigate={setOpenId} onClose={() => setOpenId(null)} /> : null}
    {manualOpen ? <ManualOrderV2 groupBuy={groupBuy} close={() => setManualOpen(false)} /> : null}
    {trackingOpen ? <TrackingImportV2 state={state} groupBuy={groupBuy} close={() => setTrackingOpen(false)} /> : null}
  </>;
}

/**
 * 출력 대기 주문의 품목 합계. 택배 엑셀을 뽑기 전에 이번에 보낼 수량과 재고를 맞춰 보고,
 * 모자란 품목은 바로 추가 발주 목록으로 복사한다.
 */
function ReadyItemsPanel({ state, groupBuy }: { state: GroupBuyState; groupBuy: GroupBuy }) {
  const copy = useCopy();
  const rows = readyItemsReport(state, groupBuy);
  const short = rows.filter((row) => row.shortage > 0);
  const totalQty = rows.reduce((sum, row) => sum + row.readyQty, 0);
  const shortQty = short.reduce((sum, row) => sum + row.shortage, 0);
  const label = (row: ReadyItemRow) => groupBuy.products.length > 1 ? `${row.productName} ${row.optionName}` : row.optionName;
  const orderText = () => [`[${groupBuy.title}] 추가 발주`, ...short.map((row) => `${label(row)} ${row.shortage}개`), `합계 ${shortQty}개`].join("\n");
  return <details className="gbx-ready" open>
    <summary>
      <span><b>출력 대기 품목</b> {rows.length}종 · {totalQty}개</span>
      {short.length ? <span className="red">부족 {short.length}종 · 추가 발주 {shortQty}개</span> : <span className="ok">재고 충분</span>}
      <ChevronDown />
    </summary>
    <div className="gbx-ready-body">
      <table className="gbx-ready-table">
        <thead><tr><th>품목</th><th className="num">주문</th><th className="num">보낼 수량</th><th className="num">남은 재고</th><th className="num">부족</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.optionId} className={row.shortage ? "short" : ""}>
          <td>{label(row)}{row.soldOut ? <span className="gbx-pill cancelled">품절 확정</span> : null}</td>
          <td className="num">{row.orderCount}건</td>
          <td className="num"><b>{row.readyQty}</b></td>
          <td className="num">{row.available == null ? "무제한" : row.available}</td>
          <td className="num">{row.shortage ? <b className="red">{row.shortage}</b> : <span className="gbx-muted">—</span>}</td>
        </tr>)}</tbody>
      </table>
      <div className="gbx-ready-foot">
        <p className="gbx-help">남은 재고 = 전체 재고 − 이미 택배 엑셀로 내보낸 수량. 입고되면 재고 탭에서 수량을 더하세요.</p>
        {short.length ? <button type="button" className="gbx-btn sm" onClick={() => copy(orderText(), "추가 발주 목록")}><Copy />발주 목록 복사</button> : null}
      </div>
    </div>
  </details>;
}

/** 품목은 최대 두 줄. 3종까지 보여주고 나머지는 "외 N"으로 묶는다. */
const ITEMS_SHOWN = 3;
function ItemsCell({ order }: { order: GbOrder }) {
  const shown = order.items.slice(0, ITEMS_SHOWN);
  const rest = order.items.length - shown.length;
  return <div className="gbx-chips-wrap" title={rest > 0 ? order.items.map((item) => `${item.itemName ?? item.optionName} ×${item.quantity}`).join("\n") : undefined}>
    {shown.map((item) => <span key={item.optionId}>{item.itemName ?? item.optionName}<b>×{item.quantity}</b></span>)}{rest > 0 ? <span className="more">외 {rest}</span> : null}
  </div>;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const pickDelivery = (order: GbOrder): DeliveryFields => ({ customerName: order.customerName, phone: order.phone, recipientName: order.recipientName, recipientPhone: order.recipientPhone, postcode: order.postcode, address: order.address, addressDetail: order.addressDetail, shippingMessage: order.shippingMessage, depositorName: order.depositorName });

/**
 * 오른쪽 주문 패널. ↑↓(또는 위아래 버튼)로 목록의 다음 주문으로 넘어가고,
 * 입금 확인을 누르면 자동으로 다음 주문을 연다(은행 내역을 위에서부터 차례로 대조하는 흐름).
 */
function OrderPanel({ state, groupBuy, orderId, ids, onNavigate, onClose }: { state: GroupBuyState; groupBuy: GroupBuy; orderId: string; ids: string[]; onNavigate: (id: string) => void; onClose: () => void }) {
  const run = useRun();
  const copy = useCopy();
  const toast = useContext(ToastContext);
  const order = state.orders.find((item) => item.id === orderId);
  // 처리 후 목록에서 빠져도 패널 안의 위치를 기억해 다음 주문으로 간다.
  const [frozenIds] = useState(ids);
  const index = frozenIds.indexOf(orderId);
  const prevId = index > 0 ? frozenIds[index - 1] : null;
  const nextId = index >= 0 && index < frozenIds.length - 1 ? frozenIds[index + 1] : null;
  const [editing, setEditing] = useState<"items" | "delivery" | null>(null);
  const [delivery, setDelivery] = useState<DeliveryFields | null>(order ? pickDelivery(order) : null);
  const [cart, setCart] = useState<Cart>(() => Object.fromEntries((order?.items ?? []).map((item) => [item.optionId, item.quantity])));
  const [overStock, setOverStock] = useState(false);
  const [note, setNote] = useState(order?.sellerNote ?? "");
  const [courier, setCourier] = useState(order?.courier || COURIERS[0]);
  const [trackingNo, setTrackingNo] = useState(order?.trackingNo ?? "");
  const [pin, setPin] = useState("");
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const trackingRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => { if (order && stageOf(order) === "tracking") trackingRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order || !delivery) return null;
  const stage = stageOf(order);
  const editable = !order.cancelledAt && order.status !== "COMPLETED";
  const area = remoteAreaOf(order.postcode, order.address);
  const lookupUrl = absoluteUrl(orderViewPath(order.lookupToken));
  const reserved = Object.fromEntries(order.items.map((item) => [item.optionId, item.quantity]));
  const preview = editing === "items" ? priceCart(groupBuy, cartLines(cart), order.postcode, order.address) : null;
  const smsBody = differenceSmsText({ ...order, sellerNote: note }, groupBuy, lookupUrl);
  const goNextOrClose = () => { if (nextId) onNavigate(nextId); else onClose(); };

  function confirmAndNext() {
    if (run((current) => confirmPayments(current, [order!.id]), `${order!.depositorName} ${won(order!.total)} 입금 확인`, (current) => revertPayment(current, order!.id))) goNextOrClose();
  }
  function saveItems(allow: boolean) {
    try { updateGroupBuyState((current) => editOrderItems(current, order!.id, cartLines(cart), allow)); setEditing(null); setOverStock(false); toast({ message: "품목을 고치고 금액을 다시 계산했어요." }); }
    catch (error) { if (error instanceof GroupBuyError && error.code === "STOCK") setOverStock(true); else run(() => { throw error; }); }
  }

  return <div className="gbx-panel-layer">
    <div className="gbx-panel-dim" onClick={onClose} aria-hidden="true" />
    <aside className="gbx-panel" role="dialog" aria-modal="true" aria-label={`주문 ${order.orderNo}`}>
      <header className="gbx-panel-head">
        <div><span className="gbx-mono">{order.orderNo}</span><StagePill stage={stage} /></div>
        <div className="gbx-panel-nav">
          {index >= 0 ? <span>{index + 1} / {frozenIds.length}</span> : null}
          <button type="button" className="gbx-icon-btn" aria-label="이전 주문 (↑)" title="이전 주문 (↑)" disabled={!prevId} onClick={() => prevId && onNavigate(prevId)}><ChevronLeft className="up" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="다음 주문 (↓)" title="다음 주문 (↓)" disabled={!nextId} onClick={() => nextId && onNavigate(nextId)}><ChevronRight className="down" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}><X /></button>
        </div>
      </header>

      <div className="gbx-panel-body">
        <section className="gbx-hero">
          <div><small>입금자명</small><strong className={order.depositorName !== order.customerName ? "red" : ""}>{order.depositorName}</strong></div>
          <div><small>입금할 금액</small><strong className="red">{won(order.total)}</strong></div>
          <p>{order.customerName} · {order.phone} · {longDateTime(order.createdAt)} {order.source === "manual" ? "수기 등록" : "주문서"}</p>
          {order.paidAt ? <p>입금 확인 {longDateTime(order.paidAt)}{order.exportedAt ? ` · 엑셀 출력 ${longDateTime(order.exportedAt)}` : ""}</p> : null}
        </section>

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>주문 상품</h3>{editable && editing !== "items" ? <button type="button" className="gbx-link" onClick={() => setEditing("items")}>품목 수정</button> : null}</div>
          {editing === "items" ? <>
            <CartPicker groupBuy={groupBuy} cart={cart} onChange={(next) => { setCart(next); setOverStock(false); }} compact allowOverStock reserved={reserved} />
            {preview ? <dl className="gbx-sum"><div><dt>상품</dt><dd>{won(preview.subtotal)}</dd></div><div><dt>배송비</dt><dd>{won(preview.shippingFee)}</dd></div><div className="total"><dt>바뀐 금액</dt><dd>{won(preview.total)}</dd></div></dl> : null}
            <p className="gbx-help">기존 옵션은 주문 당시 단가, 새로 넣은 옵션은 지금 단가로 계산해요.</p>
            {overStock ? <p className="gbx-warn">품절 확정된 옵션이 들어 있어요. 그래도 저장할까요?</p> : null}
            <div className="gbx-sec-actions"><button type="button" className="gbx-btn ghost" onClick={() => { setEditing(null); setCart(reserved); setOverStock(false); }}>취소</button><button type="button" className="gbx-btn primary" onClick={() => saveItems(overStock)}>{overStock ? "품절 옵션 포함해 저장" : "품목 저장"}</button></div>
          </> : <>
            <ul className="gbx-items">{order.items.map((item) => <li key={item.optionId}><span>{item.itemName ?? item.optionName}</span><span>×{item.quantity}</span><b>{won(item.lineTotal)}</b></li>)}</ul>
            <dl className="gbx-sum">
              <div><dt>상품</dt><dd>{won(order.subtotal)}</dd></div>
              <div><dt>배송비{area ? ` (${remoteAreaLabel(area)})` : ""}</dt><dd>{won(order.shippingFee)}</dd></div>
              {order.discount ? <div><dt>할인</dt><dd>−{won(order.discount)}</dd></div> : null}
              <div className="total"><dt>최종 금액</dt><dd>{won(order.total)}</dd></div>
            </dl>
          </>}
        </section>

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>배송지</h3>{!order.cancelledAt && editing !== "delivery" ? <button type="button" className="gbx-link" onClick={() => { setDelivery(pickDelivery(order)); setEditing("delivery"); }}>수정</button> : null}</div>
          {editing === "delivery" ? <>
            <div className="gbx-form">
              {([["customerName", "주문자"], ["phone", "휴대폰"], ["recipientName", "받는 분"], ["recipientPhone", "받는 분 연락처"], ["depositorName", "입금자명"], ["postcode", "우편번호"]] as const).map(([key, label]) => <label key={key}>{label}<input value={delivery[key]} onChange={(e) => setDelivery({ ...delivery, [key]: e.target.value })} /></label>)}
              <label className="full">주소<input value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></label>
              <label className="full">상세 주소<input value={delivery.addressDetail} onChange={(e) => setDelivery({ ...delivery, addressDetail: e.target.value })} /></label>
              <label className="full">배송 메시지<input value={delivery.shippingMessage} onChange={(e) => setDelivery({ ...delivery, shippingMessage: e.target.value })} /></label>
            </div>
            <div className="gbx-sec-actions"><button type="button" className="gbx-btn ghost" onClick={() => setEditing(null)}>취소</button><button type="button" className="gbx-btn primary" onClick={() => { if (run((current) => editOrderDelivery(current, order.id, delivery), "배송지를 저장했어요.")) setEditing(null); }}>배송지 저장</button></div>
          </> : <dl className="gbx-kv">
            <div><dt>받는 분</dt><dd>{order.recipientName} · {order.recipientPhone}</dd></div>
            <div><dt>주소</dt><dd>{order.postcode ? `(${order.postcode}) ` : ""}{order.address} {order.addressDetail}{area ? <span className="gbx-pill late">{remoteAreaLabel(area)}</span> : null}</dd></div>
            {order.shippingMessage ? <div><dt>메시지</dt><dd>{order.shippingMessage}</dd></div> : null}
            {order.trackingNo ? <div><dt>송장</dt><dd>{order.courier} <span className="gbx-mono">{order.trackingNo}</span> <a className="gbx-link" href={trackingUrl(order.courier, order.trackingNo)} target="_blank" rel="noreferrer">배송 조회</a></dd></div> : null}
          </dl>}
        </section>

        {!order.cancelledAt ? <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>고객에게 안내</h3></div>
          <label className="gbx-note">판매자 메모 <span>고객 조회 화면에 보여요 · 입력칸을 벗어나면 자동 저장</span><textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note.trim() !== order.sellerNote) run((current) => setSellerNote(current, order.id, note), "메모를 저장했어요. 고객 조회 화면에 보여요."); }} placeholder="예: 25,900원 입금 확인했어요. 배송비 3,000원 추가 입금 부탁드립니다." /></label>
          <div className="gbx-sec-actions start">
            <button type="button" className="gbx-btn" disabled={note === order.sellerNote} onClick={() => run((current) => setSellerNote(current, order.id, note), "메모를 저장했어요.")}>메모 저장</button>
            <a className="gbx-btn" href={smsHref(order.phone, smsBody)} onClick={() => { if (note !== order.sellerNote) run((current) => setSellerNote(current, order.id, note)); }}><MessageSquareText />문자 보내기</a>
            <button type="button" className="gbx-btn ghost" onClick={() => copy(paymentGuideText(order, groupBuy, absoluteUrl(lookupPath())), "입금 안내 문구")}><Copy />입금 안내 복사</button>
            <button type="button" className="gbx-btn ghost" onClick={() => copy(lookupUrl, "주문 조회 링크")}><Link2 />조회 링크 복사</button>
          </div>
        </section> : null}

        <details className="gbx-fold">
          <summary>조회 비밀번호 재설정<ChevronDown /></summary>
          <div className="gbx-inline"><input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="새 비밀번호 4자리" inputMode="numeric" aria-label="새 조회 비밀번호" /><button type="button" className="gbx-btn" disabled={pin.length !== 4} onClick={() => { if (run((current) => resetLookupPin(current, order.id, pin), "조회 비밀번호를 바꿨어요.")) setPin(""); }}>재설정</button></div>
          <p className="gbx-help">같은 휴대폰 번호의 모든 공구 주문에 적용되고 조회 잠금도 풀려요. <a className="gbx-link" href={orderViewPath(order.lookupToken)} target="_blank" rel="noreferrer">고객 화면 보기</a></p>
        </details>
        <details className="gbx-fold">
          <summary>변경 이력 {order.events.length}<ChevronDown /></summary>
          <ol className="gbx-events">{[...order.events].reverse().map((item) => <li key={item.id}><time>{dateTime(item.createdAt)}</time><span>{item.fromStatus || item.toStatus ? <b>{[item.fromStatus ? statusLabels[item.fromStatus] : null, item.toStatus ? statusLabels[item.toStatus] : "취소"].filter(Boolean).join(" → ")} </b> : null}{item.note}</span><small>{item.actor === "customer" ? "고객" : "관리자"}</small></li>)}</ol>
        </details>
        {!order.cancelledAt ? <div className="gbx-cancel">
          {cancelReason == null ? <button type="button" className="gbx-link red" onClick={() => setCancelReason("")}>주문 취소</button>
            : <div className="gbx-inline"><input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="취소 사유 (선택)" autoFocus /><button type="button" className="gbx-btn ghost" onClick={() => setCancelReason(null)}>닫기</button><button type="button" className="gbx-btn danger" onClick={() => { if (run((current) => cancelOrder(current, order.id, cancelReason), "주문을 취소하고 재고를 되돌렸어요.")) setCancelReason(null); }}>취소 확정</button></div>}
          <p className="gbx-help">취소하면 재고가 돌아와요. 입금받은 주문이면 환불은 따로 해주세요.</p>
        </div> : null}
      </div>

      <footer className="gbx-panel-foot">
        {stage === "waiting" ? <>
          <button type="button" className="gbx-btn primary wide" onClick={confirmAndNext}><Check />{won(order.total)} 입금 확인{nextId ? " · 다음 주문" : ""}</button>
        </> : stage === "ready" ? <>
          <span className="gbx-foot-note">입금 확인됨 · 다음 택배 엑셀에 들어가요</span>
          <button type="button" className="gbx-btn" onClick={() => run((current) => revertPayment(current, order.id), "입금 대기로 되돌렸어요.")}>입금 확인 취소</button>
        </> : stage === "tracking" || stage === "shipped" ? <div className="gbx-inline grow">
          <Truck />
          <select value={courier} onChange={(e) => setCourier(e.target.value)} aria-label="택배사">{COURIERS.map((item) => <option key={item}>{item}</option>)}</select>
          <input ref={trackingRef} value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="송장번호" aria-label="송장번호" inputMode="numeric" onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click(); }} />
          <button type="button" className="gbx-btn primary" disabled={trackingNo === order.trackingNo && courier === (order.courier || COURIERS[0])} onClick={() => { if (run((current) => setTracking(current, [{ orderId: order.id, courier, trackingNo }], "manual"), trackingNo.trim() ? "송장을 저장했어요. 고객 조회에 보여요." : "송장을 지웠어요.") && trackingNo.trim() && stage === "tracking") goNextOrClose(); }}>{stage === "tracking" ? "저장 · 다음" : "송장 저장"}</button>
        </div> : <span className="gbx-foot-note">취소된 주문이에요{order.cancelledAt ? ` · ${longDateTime(order.cancelledAt)}` : ""}</span>}
      </footer>
    </aside>
  </div>;
}

// ── 재고 ─────────────────────────────────────────────────

/** 옵션 축이 있는 상품은 행 = 실측표 그룹(종류·기장), 열 = 나머지(사이즈·컬러)인 표로 본다. */
function stockGrid(product: GbProduct) {
  const axes = axesFor(product).map((axis) => axis.name);
  if (axes.length < 2) return null;
  const rowAxes = product.sizeChart?.groupAxes.length ? product.sizeChart.groupAxes : axes.slice(0, Math.ceil(axes.length / 2));
  const colAxes = axes.filter((axis) => !rowAxes.includes(axis));
  const key = (attrs: Record<string, string>, names: string[]) => names.map((name) => attrs[name]).join(" ");
  const unique = (names: string[]) => [...new Set(product.options.map((option) => key(option.attrs ?? {}, names)))];
  // 열 순서는 축에 적힌 값 순서를 따른다(FREE→L, 블랙→멜란지).
  const order = (names: string[]) => (value: string) => value.split(" ").reduce((sum, part, i) => sum * 10 + (axesFor(product).find((axis) => axis.name === names[i])?.values.indexOf(part) ?? 0), 0);
  const rows = unique(rowAxes).sort((a, b) => order(rowAxes)(a) - order(rowAxes)(b));
  const cols = unique(colAxes).sort((a, b) => order(colAxes)(a) - order(colAxes)(b));
  const cell = (row: string, col: string) => product.options.find((option) => key(option.attrs ?? {}, rowAxes) === row && key(option.attrs ?? {}, colAxes) === col) ?? null;
  return { rowAxes, colAxes, rows, cols, cell };
}

function StockView({ state, groupBuy }: { state: GroupBuyState; groupBuy: GroupBuy }) {
  const run = useRun();
  const report = stockReport(state, groupBuy);
  const byId = new Map(report.map((row) => [row.optionId, row]));
  const [picked, setPicked] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [reason, setReason] = useState("");
  const copy = useCopy();
  const limited = report.filter((row) => row.stockQty != null);
  const total = limited.reduce((sum, row) => sum + (row.stockQty ?? 0), 0);
  const sold = limited.reduce((sum, row) => sum + row.waitingQty + row.paidQty, 0);
  const left = limited.reduce((sum, row) => sum + row.remaining, 0);
  const short = report.filter((row) => row.shortage > 0).sort((a, b) => b.shortage - a.shortage);
  const shortQty = short.reduce((sum, row) => sum + row.shortage, 0);
  const label = (row: StockRow) => groupBuy.products.length > 1 ? `${row.productName} ${row.optionName}` : row.optionName;
  const pickedRow = picked ? byId.get(picked) ?? null : null;
  const optionIds = new Set(report.map((row) => row.optionId));
  const logs = state.stockLogs.filter((log) => optionIds.has(log.optionId)).slice(0, 50);
  const orderNo = new Map(state.orders.map((order) => [order.id, order.orderNo]));

  function pick(optionId: string) { setPicked(optionId === picked ? null : optionId); setChange(""); setReason(""); }
  function save() {
    if (!pickedRow) return;
    if (run((current) => adjustStock(current, groupBuy.id, pickedRow.optionId, Number(change.replace(/\s/g, "")), reason), `${pickedRow.optionName} 재고 ${Number(change) > 0 ? "+" : ""}${change}`)) { setChange(""); setReason(""); }
  }

  const Cell = ({ row }: { row: StockRow }) => {
    const used = row.waitingQty + row.paidQty;
    const ratio = row.stockQty ? Math.min(1, used / row.stockQty) : 0;
    return <button type="button" className={`gbx-cell ${row.level} ${picked === row.optionId ? "picked" : ""}`} onClick={() => pick(row.optionId)} aria-label={`${row.optionName} ${row.shortage ? `부족 ${row.shortage}` : `남은 ${row.stockQty == null ? "무제한" : row.remaining}`}${row.soldOut ? " · 품절 확정" : ""}`}>
      {/* 부족하면 남은 수량 대신 모자란 수량을 −로 보여준다. */}
      <strong>{row.stockQty == null ? "∞" : row.shortage ? `−${row.shortage}` : row.remaining}</strong>
      <small>{row.soldOut ? "품절 확정" : row.stockQty == null ? "무제한" : row.shortage ? "부족" : `/ ${row.stockQty}`}</small>
      {row.stockQty != null ? <i style={{ width: `${ratio * 100}%` }} /> : null}
    </button>;
  };

  return <div className="gbx-stock">
    <dl className="gbx-stock-sum">
      <div><dt>전체 재고</dt><dd>{total.toLocaleString()}</dd></div>
      <div><dt>주문된 수량</dt><dd>{sold.toLocaleString()}</dd></div>
      <div><dt>남은 재고</dt><dd>{left.toLocaleString()}</dd></div>
      <div><dt>부족 (추가 발주)</dt><dd className={shortQty ? "red" : ""}>{shortQty.toLocaleString()}<small>{short.length ? ` · ${short.length}종` : ""}</small></dd></div>
      <div><dt>품절 확정</dt><dd>{report.filter((row) => row.soldOut).length}</dd></div>
    </dl>

    {short.length ? <section className="gbx-short">
      <div className="gbx-sec-head"><h3>부족한 옵션 {short.length}종 · {shortQty}개</h3><button type="button" className="gbx-btn sm" onClick={() => copy([`[${groupBuy.title}] 추가 발주`, ...short.map((row) => `${label(row)} ${row.shortage}개`), `합계 ${shortQty}개`].join("\n"), "추가 발주 목록")}><Copy />발주 목록 복사</button></div>
      <p className="gbx-help">재고보다 주문이 더 들어온 옵션이에요. 주문은 계속 받아요. 더 못 구하는 옵션은 칸을 눌러 ‘품절 확정’하면 고객이 고를 수 없어요.</p>
      <ul className="gbx-short-list">{short.map((row) => <li key={row.optionId}><button type="button" onClick={() => pick(row.optionId)} className={picked === row.optionId ? "picked" : ""}><span>{label(row)}</span><b>{row.shortage}개</b>{row.soldOut ? <small>품절 확정</small> : null}</button></li>)}</ul>
    </section> : null}

    {groupBuy.products.map((product) => {
      const grid = stockGrid(product);
      return <section key={product.id} className="gbx-sec">
        <div className="gbx-sec-head"><h3>{product.name}</h3><span className="gbx-help">칸을 누르면 아래에서 수량 조정·품절 확정 · 남은 수량 / 전체 · 빨간 −숫자는 부족분</span></div>
        {grid ? <div className="gbx-matrix-wrap"><table className="gbx-matrix">
          <thead><tr><th>{grid.rowAxes.join(" · ")} \ {grid.colAxes.join(" · ")}</th>{grid.cols.map((col) => <th key={col}>{col}</th>)}</tr></thead>
          <tbody>{grid.rows.map((row) => <tr key={row}><th>{row}</th>{grid.cols.map((col) => { const option = grid.cell(row, col); const stock = option ? byId.get(option.id) : null; return <td key={col}>{stock ? <Cell row={stock} /> : <span className="gbx-cell none">—</span>}</td>; })}</tr>)}</tbody>
        </table></div> : <div className="gbx-cells">{product.options.map((option) => { const stock = byId.get(option.id); return stock ? <div key={option.id} className="gbx-cell-row"><span>{option.name}</span><Cell row={stock} /></div> : null; })}</div>}
      </section>;
    })}

    {pickedRow ? <section className="gbx-adjust" aria-label="재고 조정">
      <div className="gbx-adjust-head"><strong>{pickedRow.productName} · {pickedRow.optionName}</strong><button type="button" className="gbx-icon-btn" aria-label="닫기" onClick={() => setPicked(null)}><X /></button></div>
      <dl className="gbx-kv row"><div><dt>전체</dt><dd>{pickedRow.stockQty ?? "무제한"}</dd></div><div><dt>입금 대기</dt><dd>{pickedRow.waitingQty}</dd></div><div><dt>입금 확인</dt><dd>{pickedRow.paidQty}</dd></div><div><dt>남은 재고</dt><dd>{pickedRow.stockQty == null ? "—" : pickedRow.remaining}</dd></div><div><dt>부족</dt><dd className={pickedRow.shortage ? "red" : ""}>{pickedRow.shortage}</dd></div></dl>
      <div className="gbx-soldout-row">
        <span>{pickedRow.soldOut ? <><b>품절 확정됨</b> · 고객이 이 옵션을 고를 수 없어요. 이미 들어온 주문은 그대로예요.</> : <>더 구할 수 없으면 품절 확정하세요. 확정 전까지는 재고가 모자라도 주문을 받아요.</>}</span>
        <button type="button" className={`gbx-btn sm ${pickedRow.soldOut ? "" : "danger"}`} onClick={() => run((current) => setSoldOut(current, groupBuy.id, pickedRow.optionId, !pickedRow.soldOut), pickedRow.soldOut ? `${pickedRow.optionName} 품절을 해제했어요. 다시 주문받아요.` : `${pickedRow.optionName} 품절 확정. 고객 화면에서 막혔어요.`)}>{pickedRow.soldOut ? "품절 해제" : "품절 확정"}</button>
      </div>
      {pickedRow.stockQty != null ? <div className="gbx-inline">
        <button type="button" className="gbx-btn" onClick={() => setChange(String((Number(change) || 0) - 1))}>−1</button>
        <input value={change} onChange={(e) => setChange(e.target.value.replace(/[^\d+-]/g, ""))} placeholder="+10 / -2" inputMode="numeric" aria-label="조정 수량" className="qty" />
        <button type="button" className="gbx-btn" onClick={() => setChange(String((Number(change) || 0) + 1))}>+1</button>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 추가 발주 입고, 불량)" aria-label="조정 사유" className="grow" onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <button type="button" className="gbx-btn primary" disabled={!change || !reason.trim()} onClick={save}>조정 저장</button>
      </div> : <p className="gbx-help">재고를 관리하지 않는 옵션이에요. 설정에서 수량을 넣으면 조정할 수 있어요.</p>}
    </section> : null}

    <details className="gbx-fold">
      <summary>재고 변동 이력 {logs.length}<ChevronDown /></summary>
      <ol className="gbx-events">{logs.map((log) => <li key={log.id}><time>{dateTime(log.createdAt)}</time><span>{byId.get(log.optionId)?.optionName} <b className={log.change > 0 ? "" : "red"}>{log.change > 0 ? `+${log.change}` : log.change}</b></span><small>{log.reason}{log.orderId ? ` · ${orderNo.get(log.orderId)?.slice(-4) ?? ""}` : ""}{log.note ? ` · ${log.note}` : ""}</small></li>)}</ol>
    </details>
    <p className="gbx-help">남은 재고 = 전체 − (입금 대기 + 입금 확인). 주문이 들어오면 바로 빠지고, 취소하면 돌아와요. 0이 되면 고객 화면에서 자동으로 품절돼요.</p>
  </div>;
}

// ── 화면 ─────────────────────────────────────────────────

export default function GroupBuyAdminV2({ groupBuyId, tab }: { groupBuyId?: string; tab?: string }) {
  const state = useGroupBuyState();
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((next: Omit<Toast, "id">) => setToast({ ...next, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 7000 : 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // 상세(설정)에서 공구를 지우면 목록으로 넘어오며 화면이 새로 그려지므로, 되돌리기 토스트는 여기서 띄운다.
  useEffect(() => {
    if (groupBuyId) return;
    const removed = takeDeletedGroupBuy();
    if (removed) show({ message: `‘${removed.groupBuy.title}’ 공구를 삭제했어요.`, undo: () => { updateGroupBuyState((current) => restoreGroupBuy(current, removed)); show({ message: "되돌렸어요." }); } });
  }, [groupBuyId, show]);

  return <Shell section="group-buys" basePath="/test">
    <ToastContext.Provider value={show}>
      <div className="gbx">
        {!state ? <p className="gbx-help">불러오는 중…</p> : groupBuyId ? <DetailPage state={state} groupBuyId={groupBuyId} initialTab={tab === "stock" || tab === "settings" ? tab : "orders"} /> : <ListPage state={state} />}
      </div>
      {toast ? <div key={toast.id} className={`gbx-toast ${toast.error ? "error" : ""}`} role="status">
        <span>{toast.message}</span>
        {toast.undo ? <button type="button" onClick={() => { toast.undo!(); }}>되돌리기</button> : null}
        <button type="button" aria-label="닫기" onClick={() => setToast(null)}><X /></button>
      </div> : null}
    </ToastContext.Provider>
  </Shell>;
}

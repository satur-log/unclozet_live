"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import {
  addCustomerCheck, customerCheckCount, customerLastOrderedAt, customerOrderHistory, customerStatusLabel, deleteCustomer, deleteCustomerCheck,
  editCustomer, editCustomerCheck, ensureCustomer, hasSavedDelivery, importCustomers, setCustomerBlocked, summarizeCustomerImport,
} from "./model";
import { parseCustomerWorkbookRows } from "./customer-import";
import type { Customer, CustomerCheck, CustomerImportRecord, CustomerImportSummary } from "./types";
import { useDashboard } from "./provider";
import { Shell } from "./shell";
import { CustomerPill, isTyping, StatusPill, won } from "./broadcasts-v2";
import { Modal } from "../group-buy/dialogs-v2";
import "../group-buy/admin-v2.css";
import "./broadcasts-v2.css";

// 고객 관리 — 공구·방송 화면과 같은 결(흰 바탕·얇은 선·검정 버튼).

const today = () => new Date().toLocaleDateString("en-CA");
const orderDate = (value: string | null) => {
  if (!value) return "주문 이력 없음";
  const d = new Date(value); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type SortKey = "instagramId" | "name" | "phone" | "address" | "status" | "lastOrderedAt";
type Item = { customer: Customer; lastOrderedAt: string | null };
type View = "all" | "checked" | "blocked";
const sortValue = (item: Item, key: SortKey) => key === "instagramId" ? item.customer.instagramId : key === "name" ? item.customer.delivery.name : key === "phone" ? item.customer.delivery.phone
  : key === "address" ? item.customer.delivery.address : key === "status" ? customerStatusLabel(item.customer) : item.lastOrderedAt ?? "";

function CustomersPage() {
  const { state, commit, notify } = useDashboard();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "lastOrderedAt", direction: "desc" });
  const [reading, setReading] = useState(false);
  const [importDraft, setImportDraft] = useState<{ fileName: string; records: CustomerImportRecord[]; summary: CustomerImportSummary } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key !== "/" || openId || importDraft || isTyping(event.target)) return; event.preventDefault(); searchRef.current?.focus(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, importDraft]);

  const all = useMemo(() => state.customers.map((customer) => ({ customer, lastOrderedAt: customerLastOrderedAt(state, customer) })), [state]);
  const counts: Record<View, number> = { all: all.length, checked: all.filter(({ customer }) => !customer.blocked && customerCheckCount(customer) > 0).length, blocked: all.filter(({ customer }) => customer.blocked).length };
  const list = useMemo(() => all
    .filter(({ customer }) => view === "all" || (view === "blocked" ? customer.blocked : !customer.blocked && customerCheckCount(customer) > 0))
    .filter(({ customer }) => !query.trim() || customer.instagramId.toLowerCase().includes(query.toLowerCase()) || customer.delivery.name.includes(query))
    .sort((a, b) => {
      const comparison = sortValue(a, sort.key).localeCompare(sortValue(b, sort.key), "ko", { numeric: true, sensitivity: "base" });
      if (comparison) return sort.direction === "asc" ? comparison : -comparison;
      return a.customer.instagramId.localeCompare(b.customer.instagramId, "ko", { numeric: true, sensitivity: "base" });
    }), [all, view, query, sort]);
  const ids = list.map(({ customer }) => customer.id);

  const changeSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  const head = (label: string, key: SortKey) => {
    const active = sort.key === key;
    return <th aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`gbx-sort-head ${active ? "active" : ""}`} onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>
    </th>;
  };

  async function selectWorkbook(file: File) {
    if (file.size > 10 * 1024 * 1024) { notify("10MB 이하의 엑셀 파일을 선택하세요.", true); return; }
    setReading(true);
    try {
      const sheets = await readXlsxFile(file);
      const sheet = sheets.find((item) => item.sheet === "배송주문") ?? sheets[0];
      if (!sheet) throw new Error("엑셀 파일에 읽을 수 있는 시트가 없습니다.");
      const records = parseCustomerWorkbookRows(sheet.data);
      setImportDraft({ fileName: file.name, records, summary: summarizeCustomerImport(state, records) });
    } catch (error) { notify(error instanceof Error ? error.message : "엑셀 파일을 읽지 못했습니다.", true); }
    finally { setReading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  function addById() {
    if (adding == null) return;
    let customerId = ""; let created = false;
    const ok = commit((current) => { const result = ensureCustomer(current, adding); customerId = result.customerId; created = result.created; return result.state; });
    if (!ok) return;
    notify(created ? "아이디로 고객을 추가했어요. 체크나 차단을 기록하세요." : "이미 저장된 고객이에요. 그 고객을 열었어요.");
    setAdding(null); setView("all"); setQuery(""); setOpenId(customerId);
  }
  function confirmImport() {
    if (!importDraft) return;
    const { created, updated, unchanged } = importDraft.summary;
    if (commit((current) => importCustomers(current, importDraft.records).state, `고객정보를 가져왔습니다. 신규 ${created}명 · 수정 ${updated}명 · 동일 ${unchanged}명`)) setImportDraft(null);
  }

  return <>
    <header className="gbx-head">
      <div><h1>고객 관리</h1><p className="gbx-meta">고객별 배송 정보를 확인하고 관리해요 · 총 <b>{all.length}명</b></p></div>
      <div className="gbx-head-actions">
        <input ref={fileRef} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectWorkbook(file); }} />
        <button type="button" className="gbx-btn" onClick={() => setAdding("")}><Plus />아이디로 추가</button>
        <button type="button" className="gbx-btn" disabled={reading} onClick={() => fileRef.current?.click()}><Upload />{reading ? "읽는 중…" : "엑셀 업로드"}</button>
      </div>
    </header>

    <div className="gbx-toolbar">
      <label className="gbx-search"><Search /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="인스타그램 ID 또는 이름 검색" aria-label="고객 검색" />{query ? <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button> : <kbd>/</kbd>}</label>
    </div>
    <div className="gbx-filters">
      <div className="gbx-chips" role="tablist" aria-label="고객 상태">{([["all", "전체"], ["checked", "체크 있음"], ["blocked", "차단"]] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}<b>{counts[key]}</b></button>)}</div>
    </div>

    <div className="gbx-table-wrap">
      <table className="gbx-table gbx-cu-table">
        <colgroup><col className="c-id" /><col className="c-name" /><col className="c-phone" /><col /><col className="c-stage" /><col className="c-date" /><col className="c-arrow" /></colgroup>
        <thead><tr>{head("인스타그램 아이디", "instagramId")}{head("이름", "name")}{head("연락처", "phone")}{head("주소", "address")}{head("상태", "status")}{head("최근 주문", "lastOrderedAt")}<th><span className="sr-only">상세</span></th></tr></thead>
        <tbody>{list.map(({ customer, lastOrderedAt }) => <tr key={customer.id} className={`${openId === customer.id ? "open" : ""} ${customer.blocked ? "late" : ""}`} onClick={() => setOpenId(customer.id)}>
          <td><strong>{customer.instagramId}</strong></td>
          <td>{customer.delivery.name || <span className="gbx-muted">{hasSavedDelivery(customer) ? "—" : "아이디만"}</span>}</td>
          <td className="gbx-mono">{customer.delivery.phone || <span className="gbx-muted">—</span>}</td>
          <td title={customer.delivery.address}>{customer.delivery.address || <span className="gbx-muted">—</span>}</td>
          <td><CustomerPill customer={customer} /></td>
          <td className={lastOrderedAt ? "" : "gbx-muted"}>{orderDate(lastOrderedAt)}</td>
          <td className="act"><ChevronRight className="gbx-row-arrow" /></td>
        </tr>)}</tbody>
      </table>
      {!list.length ? <div className="gbx-empty-row">{query ? <>‘{query}’에 맞는 고객이 없어요. <button type="button" onClick={() => setQuery("")}>검색어 지우기</button></>
        : view !== "all" ? "이 상태의 고객이 없어요." : <>저장된 고객 정보가 없어요. 주문서를 등록하거나 기존 양식의 엑셀을 업로드해 고객정보를 저장하세요. <button type="button" onClick={() => fileRef.current?.click()}>엑셀 업로드</button></>}</div> : null}
    </div>

    {adding != null ? <Modal title="아이디로 고객 추가" description="주문서를 안 쓴 사람도 아이디만 저장해 두면 체크·차단을 이어갈 수 있어요. 배송정보는 나중에 주문서가 오면 채워져요." onClose={() => setAdding(null)}
      footer={<><button type="button" className="gbx-btn ghost" onClick={() => setAdding(null)}>취소</button><button type="button" className="gbx-btn primary" disabled={!adding.trim()} onClick={addById}>추가하고 열기</button></>}>
      <div className="gbx-form"><label className="full">인스타그램 아이디<input value={adding} autoFocus onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) addById(); }} placeholder="instagram_id" /></label></div>
    </Modal> : null}
    {importDraft ? <Modal title="고객정보를 가져올까요?" description={`${importDraft.fileName}에서 확인한 고객정보예요.`} onClose={() => setImportDraft(null)}
      footer={<><button type="button" className="gbx-btn ghost" onClick={() => setImportDraft(null)}>취소</button><button type="button" className="gbx-btn primary" onClick={confirmImport}>고객정보 가져오기</button></>}>
      <dl className="gbx-kv row">
        <div><dt>전체</dt><dd>{importDraft.summary.total}명</dd></div>
        <div><dt>신규</dt><dd>{importDraft.summary.created}명</dd></div>
        <div><dt>수정</dt><dd>{importDraft.summary.updated}명</dd></div>
        <div><dt>동일</dt><dd>{importDraft.summary.unchanged}명</dd></div>
      </dl>
      <p className="gbx-help">기존 ID와 정보가 다르면 고객관리의 저장정보를 엑셀 값으로 수정해요. 과거 방송 주문은 바꾸지 않아요.</p>
    </Modal> : null}
    {openId ? <CustomerPanel key={openId} customerId={openId} ids={ids} onNavigate={setOpenId} onClose={() => setOpenId(null)} /> : null}
  </>;
}

function CustomerPanel({ customerId, ids, onNavigate, onClose }: { customerId: string; ids: string[]; onNavigate: (id: string) => void; onClose: () => void }) {
  const { state, commit } = useDashboard();
  const customer = state.customers.find((item) => item.id === customerId);
  const [frozenIds] = useState(ids);
  const index = frozenIds.indexOf(customerId);
  const prevId = index > 0 ? frozenIds[index - 1] : null;
  const nextId = index >= 0 && index < frozenIds.length - 1 ? frozenIds[index + 1] : null;
  const [delivery, setDelivery] = useState(customer?.delivery ?? { name: "", address: "", phone: "" });
  const [instagramId, setInstagramId] = useState(customer?.instagramId ?? "");
  const [checkDraft, setCheckDraft] = useState<{ id: string | null; date: string; note: string } | null>(null);
  const [deletingCheckId, setDeletingCheckId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (customer) { setDelivery(customer.delivery); setInstagramId(customer.instagramId); } }, [customer?.id, customer?.delivery, customer?.instagramId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (checkDraft) setCheckDraft(null); else onClose(); return; }
      if (isTyping(event.target)) return;
      if ((event.key === "ArrowDown" || event.key === "j") && nextId) { event.preventDefault(); onNavigate(nextId); }
      if ((event.key === "ArrowUp" || event.key === "k") && prevId) { event.preventDefault(); onNavigate(prevId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextId, prevId, onClose, onNavigate, checkDraft]);

  if (!customer) return null;
  const lastOrderedAt = customerLastOrderedAt(state, customer);
  const checks = [...(customer.checkHistory ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const history = customerOrderHistory(state, customer);
  const checkCount = customerCheckCount(customer);
  const dirty = instagramId !== customer.instagramId || JSON.stringify(delivery) !== JSON.stringify(customer.delivery);
  const editCheck = (check?: CustomerCheck) => { setDeletingCheckId(null); setCheckDraft({ id: check?.id ?? null, date: check?.date ?? today(), note: check?.note ?? "" }); };
  function saveCheck() {
    if (!checkDraft) return;
    const saved = commit((current) => checkDraft.id ? editCustomerCheck(current, customer!.id, checkDraft.id, checkDraft.date, checkDraft.note) : addCustomerCheck(current, customer!.id, checkDraft.date, checkDraft.note),
      checkDraft.id ? "체크 이력을 수정했습니다." : "체크 이력을 추가했습니다.");
    if (saved) setCheckDraft(null);
  }
  const checkForm = checkDraft ? <div className="gbx-cu-check-form">
    <div className="gbx-form">
      <label>체크 날짜<input type="date" value={checkDraft.date} onChange={(e) => setCheckDraft({ ...checkDraft, date: e.target.value })} /></label>
      <label className="full">메모 <span className="gbx-help">선택</span><input value={checkDraft.note} autoFocus onChange={(e) => setCheckDraft({ ...checkDraft, note: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveCheck(); }} placeholder="예: 연락 없이 미입금" /></label>
    </div>
    <div className="gbx-sec-actions"><button type="button" className="gbx-btn ghost sm" onClick={() => setCheckDraft(null)}>취소</button><button type="button" className="gbx-btn primary sm" onClick={saveCheck}>{checkDraft.id ? "수정 저장" : "체크 추가"}</button></div>
  </div> : null;

  return <div className="gbx-panel-layer">
    <div className="gbx-panel-dim" onClick={onClose} aria-hidden="true" />
    <aside className="gbx-panel" role="dialog" aria-modal="true" aria-label={`고객 ${customer.instagramId}`}>
      <header className="gbx-panel-head">
        <div><span className="gbx-mono">@{customer.instagramId}</span><CustomerPill customer={customer} /></div>
        <div className="gbx-panel-nav">
          {index >= 0 ? <span>{index + 1} / {frozenIds.length}</span> : null}
          <button type="button" className="gbx-icon-btn" aria-label="이전 고객 (↑)" title="이전 고객 (↑)" disabled={!prevId} onClick={() => prevId && onNavigate(prevId)}><ChevronLeft className="up" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="다음 고객 (↓)" title="다음 고객 (↓)" disabled={!nextId} onClick={() => nextId && onNavigate(nextId)}><ChevronRight className="down" /></button>
          <button type="button" className="gbx-icon-btn" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}><X /></button>
        </div>
      </header>

      <div className="gbx-panel-body">
        <section className="gbx-hero">
          <div><small>방송 주문</small><strong>{history.length}건</strong></div>
          <div><small>누적 체크</small><strong className={checkCount ? "red" : ""}>{checkCount}회</strong></div>
          <p>{hasSavedDelivery(customer) ? `최근 주문 ${orderDate(lastOrderedAt)}` : "아이디만 저장된 고객이에요 · 주문서가 오면 배송정보가 채워져요"}</p>
        </section>

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>배송 정보</h3>{!hasSavedDelivery(customer) ? <span className="gbx-help">비워 둬도 저장돼요</span> : null}</div>
          <div className="gbx-form">
            <label>인스타그램 아이디<input value={instagramId} onChange={(e) => setInstagramId(e.target.value)} placeholder="instagram_id" /></label>
            <label>수령인<input value={delivery.name} onChange={(e) => setDelivery({ ...delivery, name: e.target.value })} /></label>
            <label>연락처<input value={delivery.phone} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} /></label>
            <label className="full">주소<input value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></label>
          </div>
          <div className="gbx-sec-actions"><button type="button" className="gbx-btn primary" disabled={!dirty} onClick={() => commit((current) => editCustomer(current, customer.id, delivery, instagramId), "배송 정보를 수정했습니다.")}>배송 정보 저장</button></div>
        </section>

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>고객 상태</h3><span className="gbx-help">주문 상태와 따로 관리돼요</span></div>
          <div className="gbx-cu-state">
            <span><CustomerPill customer={customer} /> 누적 체크 {checkCount}회</span>
            <button type="button" className={`gbx-btn sm ${customer.blocked ? "" : "danger"}`} onClick={() => commit((current) => setCustomerBlocked(current, customer.id, !customer.blocked), customer.blocked ? "고객 차단을 해제했습니다." : "고객을 차단했습니다.")}>{customer.blocked ? "차단 해제" : "차단하기"}</button>
          </div>
        </section>

        <section className="gbx-sec">
          <div className="gbx-sec-head"><h3>체크 이력</h3>{!checkDraft ? <button type="button" className="gbx-link" onClick={() => editCheck()}><Plus />체크 추가</button> : null}</div>
          <p className="gbx-help">기존 누적과 새 체크를 함께 계산해요.</p>
          {checkDraft && !checkDraft.id ? checkForm : null}
          <ul className="gbx-cu-checks">
            {(customer.legacyCheckCount ?? 0) > 0 ? <li className="legacy"><div><b>기존 누적 {customer.legacyCheckCount}회</b><span>일자 미상</span></div><p>발생일을 알 수 없는 기존 체크예요.</p></li> : null}
            {checks.map((check) => checkDraft?.id === check.id ? <li key={check.id}>{checkForm}</li> : <li key={check.id}>
              <div><b>{check.date ?? "일자 미상"}</b>
                <span className="gbx-cu-check-actions">{deletingCheckId === check.id ? <>
                  <button type="button" className="gbx-btn ghost xs" onClick={() => setDeletingCheckId(null)}>취소</button>
                  <button type="button" className="gbx-btn danger xs" onClick={() => { if (commit((current) => deleteCustomerCheck(current, customer.id, check.id), "체크 이력을 삭제했습니다.")) setDeletingCheckId(null); }}>삭제 확정</button>
                </> : <>
                  <button type="button" className="gbx-icon-btn" aria-label="체크 이력 수정" onClick={() => editCheck(check)}><Pencil /></button>
                  <button type="button" className="gbx-icon-btn" aria-label="체크 이력 삭제" onClick={() => setDeletingCheckId(check.id)}><Trash2 /></button>
                </>}</span>
              </div>
              <p>{check.note || "메모 없음"}</p>
            </li>)}
          </ul>
          {!checks.length && !(customer.legacyCheckCount ?? 0) && !checkDraft ? <p className="gbx-cu-empty">등록된 체크 이력이 없어요.</p> : null}
        </section>

        <details className="gbx-fold">
          <summary>주문 내역 {history.length}건<ChevronDown /></summary>
          {history.length ? <ul className="gbx-cu-history">{history.map((item) => <li key={item.id}>
            <div><b>{item.broadcastTitle}</b><StatusPill status={item.status} /></div>
            <span>{orderDate(item.orderedAt)} · {item.total == null ? "—" : won(item.total)} · {item.quantity == null ? "—" : `${item.quantity}개`}</span>
            {item.items.length ? <small>{item.items.join(" · ")}</small> : null}
          </li>)}</ul> : <p className="gbx-cu-empty">누적된 주문 내역이 없어요.</p>}
        </details>

        <div className="gbx-cancel">
          {confirming ? <div className="gbx-inline"><span className="gbx-help grow">과거 방송의 주문과 상태는 삭제되지 않아요.</span><button type="button" className="gbx-btn ghost sm" onClick={() => setConfirming(false)}>취소</button><button type="button" className="gbx-btn danger sm" onClick={() => { if (commit((current) => deleteCustomer(current, customer.id), "고객 저장정보를 삭제했습니다.")) onClose(); }}>삭제 확정</button></div>
            : <button type="button" className="gbx-link red" onClick={() => setConfirming(true)}>고객 저장정보 삭제</button>}
        </div>
      </div>
    </aside>
  </div>;
}

export default function CustomersV2({ basePath = "" }: { basePath?: string }) {
  return <Shell section="customers" basePath={basePath}><div className="gbx gbx-bc"><CustomersPage /></div></Shell>;
}

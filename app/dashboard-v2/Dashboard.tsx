"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  addBroadcast, confirmPreviousInfo, deleteBroadcast, deleteCustomer, deliveryIssues, editCustomer, editOrder, exportReadyOrders,
  matchOrder, matchingCandidates, orderIssues, registerOrder, renameBroadcast, resolveConflict, restoreOrder,
  saveDraft, saveSettlement, statusLabels,
} from "./model";
import { analyzeSettlement } from "./settlement";
import type { Broadcast, Customer, Delivery, Order, OrderStatus } from "./types";
import { useDashboard } from "./provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight, Copy, Download, Plus, Trash2 } from "lucide-react";

const won = (value: number) => new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
const displayDate = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const broadcastTitle = (value: string) => {
  const date = new Date(value);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday}) ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const download = (bytes: Uint8Array, fileName: string) => {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function Icon({ name }: { name: "live" | "customer" | "mock" }) {
  return <span className="v2-icon" aria-hidden="true">{name === "live" ? "◉" : name === "customer" ? "♙" : "◇"}</span>;
}

function Shell({ children, section }: { children: React.ReactNode; section: "broadcasts" | "customers" }) {
  const { reset } = useDashboard();
  const [resetOpen, setResetOpen] = useState(false);
  return <div className="v2-app">
    <aside className="v2-sidebar">
      <Link href="/" className="v2-brand"><span>UC</span><div><strong>언클로젯</strong></div></Link>
      <nav aria-label="주 메뉴">
        <Link href="/" className={section === "broadcasts" ? "active" : ""}><Icon name="live" />방송 내역</Link>
        <Link href="/customers" className={section === "customers" ? "active" : ""}><Icon name="customer" />고객 관리</Link>
      </nav>
      <div className="v2-local-card"><Icon name="mock" /><div><strong>가상 데이터</strong><span>현재 기기에서만 저장됩니다</span></div></div>
      <button className="v2-reset" onClick={() => setResetOpen(true)}>가상 데이터 초기화</button>
    </aside>
    <div className="v2-mobile-head"><Link href="/" className="v2-brand"><span>UC</span><strong>언클로젯</strong></Link><nav><Link href="/">방송 내역</Link><Link href="/customers">고객 관리</Link></nav></div>
    <main className="v2-main">{children}</main>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent showCloseButton={false}><DialogHeader><p className="v2-eyebrow">데이터 초기화</p><DialogTitle>가상 데이터를 처음으로 돌릴까요?</DialogTitle><DialogDescription>현재 기기에 저장된 V2 가상 데이터만 초기화합니다.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setResetOpen(false)}>취소</Button><Button variant="destructive" onClick={() => { reset(); setResetOpen(false); }}>초기화</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function BroadcastList() {
  const { state, commit } = useDashboard();
  const router = useRouter();
  const broadcasts = [...state.broadcasts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function create() { let broadcastId = ""; const saved = commit((current) => { const result = addBroadcast(current, `방송 ${broadcastTitle(new Date().toISOString())}`); broadcastId = result.broadcastId; return result.state; }, "새 방송을 만들었습니다."); if (saved) router.push(`/broadcasts/${broadcastId}`); }
  return <Shell section="broadcasts"><header className="v2-page-head"><h1>방송 내역</h1><Button onClick={create}>+ 새 방송</Button></header>
    <section className="v2-section v2-broadcasts">{broadcasts.length ? <div className="v2-broadcast-grid">{broadcasts.map((broadcast) => { const total = broadcast.orders.length; const waiting = broadcast.orders.filter((order) => order.status === "WAITING").length; return <Link href={`/broadcasts/${broadcast.id}`} key={broadcast.id} className="v2-broadcast-card"><h3>{broadcastTitle(broadcast.createdAt)}</h3><p>{total}명 · 미입금 {waiting}명</p><span className="v2-card-arrow" aria-hidden="true">→</span></Link>; })}</div> : <div className="v2-empty-panel"><strong>아직 생성한 방송이 없습니다.</strong><p>새 방송을 만들면 정산과 주문을 관리할 수 있습니다.</p><Button onClick={create}>+ 새 방송</Button></div>}</section>
  </Shell>;
}

function StatusBadge({ status }: { status: OrderStatus }) { return <Badge variant="outline" className={`v2-status ${status.toLowerCase()}`}><i />{statusLabels[status]}</Badge>; }
function EditableBroadcastTitle({ broadcast }: { broadcast: Broadcast }) {
  const { commit } = useDashboard(); const [draft, setDraft] = useState(broadcast.title);
  useEffect(() => setDraft(broadcast.title), [broadcast.id, broadcast.title]);
  function save() { if (draft === broadcast.title) return; if (!commit((current) => renameBroadcast(current, broadcast.id, draft), "방송 이름을 수정했습니다.")) setDraft(broadcast.title); }
  return <input aria-label="방송 이름" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(broadcast.title); e.currentTarget.blur(); } }} />;
}

function OrderDrawer({ broadcast, order, close }: { broadcast: Broadcast; order: Order; close: () => void }) {
  const { state, commit } = useDashboard();
  const settlement = broadcast.settlements.find((s) => s.id === order.settlementId);
  const [delivery, setDelivery] = useState<Delivery>(order.delivery ?? { name: "", address: "", phone: "" });
  const [matchId, setMatchId] = useState("");
  useEffect(() => { setDelivery(order.delivery ?? { name: "", address: "", phone: "" }); setMatchId(""); }, [order.id, order.delivery]);
  const candidates = matchingCandidates(broadcast, order);
  const issues = orderIssues(broadcast, order);
  const editable = order.status !== "COMPLETED";
  function save() { commit((current) => editOrder(current, broadcast.id, order.id, delivery), order.status === "READY" ? "출력 대기 주문의 배송정보를 수정했습니다." : "주문 정보를 저장했습니다."); }
  return <Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent className="w-full overflow-y-auto p-7 sm:max-w-lg" showCloseButton><SheetHeader className="v2-drawer-header"><p className="v2-eyebrow">주문 상세</p><SheetTitle>{order.instagramId || "아이디 미인식"}</SheetTitle><SheetDescription className="sr-only">주문 상세와 배송정보를 확인합니다.</SheetDescription></SheetHeader>
    <div className="v2-drawer-meta"><StatusBadge status={order.status} /><span>{settlement ? `${settlement.quantity}개 · ${won(settlement.total)}` : "정산 미연결"}</span></div>
    {issues.length ? <section className="v2-alert"><strong>검토할 항목 {issues.length}개</strong>{issues.map((issue, i) => <p key={`${issue.code}-${i}`}>• {issue.message}</p>)}</section> : null}
    {!order.settlementId ? <section className="v2-drawer-section"><h3>정산 주문 연결</h3><p className="v2-help">유사 후보는 자동 확정하지 않습니다.</p>{candidates.length ? <div className="v2-candidates">{candidates.map((candidate) => <button key={candidate.id} onClick={() => commit((current) => matchOrder(current, broadcast.id, order.id, candidate.id), `${candidate.instagramId} 정산 주문에 연결했습니다.`)}>{candidate.instagramId}<small>{won(candidate.total)}</small></button>)}</div> : null}<div className="v2-inline"><select value={matchId} onChange={(e) => setMatchId(e.target.value)}><option value="">전체 정산 주문에서 선택</option>{broadcast.settlements.map((s) => <option key={s.id} value={s.id}>{s.instagramId} · {won(s.total)}</option>)}</select><button disabled={!matchId} className="v2-button secondary" onClick={() => commit((current) => matchOrder(current, broadcast.id, order.id, matchId), "정산 주문을 연결했습니다.")}>연결</button></div></section> : null}
    {order.conflict ? <section className="v2-conflict"><div><p className="v2-eyebrow">ADDRESS CHANGED</p><h3>고객 정보가 달라요</h3><p>두 정보를 비교하고 이번 주문에 사용할 값을 선택하세요.</p></div><article><span>저장된 정보</span><strong>{order.conflict.previous.name}</strong><p>{order.conflict.previous.address}</p><p>{order.conflict.previous.phone}</p><button onClick={() => commit((current) => resolveConflict(current, broadcast.id, order.id, "previous"), "저장된 고객정보로 출력 대기 상태가 되었습니다.")}>저장된 정보 사용</button></article><article className="incoming"><span>신규 주문서</span><strong>{order.conflict.incoming.name}</strong><p>{order.conflict.incoming.address}</p><p>{order.conflict.incoming.phone}</p><button onClick={() => commit((current) => resolveConflict(current, broadcast.id, order.id, "incoming"), "신규 고객정보를 적용하고 출력 대기 상태가 되었습니다.")}>신규 정보 적용</button></article></section> : null}
    <section className="v2-drawer-section"><div className="v2-section-mini"><div><h3>배송 정보</h3><p>{order.status === "READY" ? "출력 대기 상태에서도 수정할 수 있습니다." : order.status === "COMPLETED" ? "재출력하려면 출력 대기로 되돌리세요." : "누락된 정보를 채우면 자동으로 출력 대기가 됩니다."}</p></div>{editable ? <button className="v2-text-button" onClick={save}>저장</button> : null}</div><div className="v2-form-grid"><label>받는분 성명<input value={delivery.name} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, name: e.target.value })} /></label><label className="full">주소<input value={delivery.address} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></label><label>연락처<input value={delivery.phone} disabled={!editable} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} placeholder="010-0000-0000" /></label></div>{deliveryIssues(delivery).map((issue) => <small className="v2-field-error" key={issue.code}>{issue.message}</small>)}</section>
    {order.status === "WAITING" && !order.registrationConfirmed && order.delivery ? <button className="v2-action-wide" onClick={() => commit((current) => confirmPreviousInfo(current, broadcast.id, order.id), "과거 고객정보를 확인하고 출력 대기로 이동했습니다.")}>과거 정보 확인 · READY로 이동</button> : null}
    {order.status === "COMPLETED" ? <button className="v2-action-wide outline" onClick={() => commit((current) => restoreOrder(current, broadcast.id, order.id), "출력 대기로 되돌렸습니다.")}>출력 대기로 되돌리기</button> : null}
  </SheetContent></Sheet>;
}

function BroadcastDetail({ broadcastId }: { broadcastId: string }) {
  const { state, commit, notify } = useDashboard();
  const router = useRouter();
  const broadcast = state.broadcasts.find((b) => b.id === broadcastId);
  const [filter, setFilter] = useState<"ALL" | OrderStatus | "ISSUES">("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  if (!broadcast) return <Shell section="broadcasts"><div className="v2-empty"><h1>방송 작업을 찾을 수 없습니다.</h1><Link href="/">방송 목록으로</Link></div></Shell>;
  const currentBroadcast = broadcast;
  const selected = currentBroadcast.orders.find((o) => o.id === selectedId) ?? null;
  const counts = { WAITING: currentBroadcast.orders.filter((o) => o.status === "WAITING").length, READY: currentBroadcast.orders.filter((o) => o.status === "READY").length, COMPLETED: currentBroadcast.orders.filter((o) => o.status === "COMPLETED").length };
  const filtered = currentBroadcast.orders.filter((order) => (filter === "ALL" || (filter === "ISSUES" ? Boolean(order.sourceText) && orderIssues(currentBroadcast, order).length > 0 : order.status === filter)) && (!query.trim() || order.instagramId.toLowerCase().includes(query.toLowerCase()) || order.delivery?.name.includes(query)));
  const announcement = analyzeSettlement(currentBroadcast.memo).announcement;
  function runSettlement() { commit((current) => saveSettlement(current, currentBroadcast.id, currentBroadcast.memoDraft), currentBroadcast.memoDraft.trim() ? "정산 내용을 분석했습니다." : "정산 입력을 비웠습니다."); }
  function runOrder() { let orderId = ""; const ok = commit((current) => { const result = registerOrder(current, currentBroadcast.id, currentBroadcast.orderDraft); orderId = result.orderId; return saveDraft(result.state, currentBroadcast.id, "orderDraft", ""); }, "주문서를 등록했습니다."); if (ok) { setOrderOpen(false); setSelectedId(orderId); } }
  function runExport() { const count = counts.READY; commit((current) => exportReadyOrders(current, currentBroadcast.id, download), `${count}건의 XLSX를 만들고 출력 완료로 이동했습니다.`); }
  function remove() { if (commit((current) => deleteBroadcast(current, currentBroadcast.id), "방송을 삭제했습니다.")) router.push("/"); }
  const totalAmount = currentBroadcast.settlements.reduce((sum, settlement) => sum + settlement.total, 0);
  const filters = [["ALL", "전체"], ["WAITING", "입금 전"], ["READY", "출력 대기"], ["COMPLETED", "완료"], ["ISSUES", "검토 필요"]] as const;

  return <Shell section="broadcasts">
    <header className="v2-detail-head v2-detail-title-row">
      <div className="v2-title-edit"><EditableBroadcastTitle broadcast={currentBroadcast} /></div>
      <div className="v2-detail-meta"><span>수정 {displayDate(currentBroadcast.updatedAt)}</span><Button variant="destructive" size="icon-sm" aria-label="방송 삭제" title="방송 삭제" onClick={() => setDeleteOpen(true)}><Trash2 /></Button></div>
    </header>

    <section className="v2-detail-stats" aria-label="방송 주문 현황">
      <Card size="sm"><CardContent><span>정산 주문</span><strong>{currentBroadcast.settlements.length}</strong><small>{won(totalAmount)}</small></CardContent></Card>
      <Card size="sm"><CardContent><span>입금 전</span><strong className="waiting">{counts.WAITING}</strong></CardContent></Card>
      <Card size="sm"><CardContent><span>출력 대기</span><strong>{counts.READY}</strong></CardContent></Card>
      <Card size="sm"><CardContent><span>출력 완료</span><strong className="completed">{counts.COMPLETED}</strong></CardContent></Card>
    </section>

    <Card className="v2-settlement-card">
      <CardContent className="v2-settlement-grid">
        <div className="v2-settlement-input">
          <div className="v2-label-row"><label htmlFor="settlement">정산 주문 입력</label></div>
          <Textarea id="settlement" value={currentBroadcast.memoDraft} onChange={(event) => commit((current) => saveDraft(current, currentBroadcast.id, "memoDraft", event.target.value))} placeholder="정산할 주문 내용을 붙여넣어 주세요." />
          <Button onClick={runSettlement}>정산 분석 실행</Button>
        </div>
        <div className="v2-settlement-preview">
          <div className="v2-label-row"><label>공지용 정산 텍스트</label><Button variant="link" size="sm" disabled={!announcement} onClick={() => navigator.clipboard.writeText(announcement).then(() => notify("공지 텍스트를 복사했습니다.")).catch(() => notify("클립보드에 접근하지 못했습니다.", true))}><Copy data-icon="inline-start" />복사</Button></div>
          <pre>{announcement || "분석을 실행하면 공지용 정산 안내문이 여기에 표시됩니다."}</pre>
          {currentBroadcast.settlementErrors.map((error) => <Alert className="v2-parse-error" key={`${error.line}-${error.text}`}><AlertDescription>{error.line}행 · {error.message}</AlertDescription></Alert>)}
        </div>
      </CardContent>
    </Card>

    <section className="v2-orders">
      <div className="v2-order-head"><h2>주문 목록</h2><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="아이디 또는 성명 검색" aria-label="주문 검색" /></div>
      <div className="v2-order-toolbar">
        <div className="v2-filters">{filters.map(([value, label]) => <Button key={value} variant={filter === value ? "default" : "ghost"} size="sm" onClick={() => setFilter(value)}>{label}{value !== "ALL" && value !== "ISSUES" ? <b>{counts[value]}</b> : null}</Button>)}</div>
        <div className="v2-order-actions"><Button variant="outline" onClick={() => setOrderOpen(true)}><Plus data-icon="inline-start" />신규 주문서 등록</Button><Button disabled={!counts.READY} onClick={runExport}><Download data-icon="inline-start" />출력 대기 엑셀 출력 <b>{counts.READY}</b></Button></div>
      </div>
      <div className="v2-table-wrap">
        <Table>
          <TableHeader><TableRow><TableHead>인스타그램 ID</TableHead><TableHead>정산</TableHead><TableHead>받는분</TableHead><TableHead>주문 상태</TableHead><TableHead><span className="sr-only">상세</span></TableHead></TableRow></TableHeader>
          <TableBody>{filtered.map((order) => { const settlement = currentBroadcast.settlements.find((item) => item.id === order.settlementId); return <TableRow key={order.id} data-state={selectedId === order.id ? "selected" : undefined} onClick={() => setSelectedId(order.id)}><TableCell><strong>{order.instagramId || "아이디 미인식"}</strong></TableCell><TableCell>{settlement ? <><strong>{won(settlement.total)}</strong><small>{settlement.quantity}개</small></> : <span className="v2-warn-text">미연결</span>}</TableCell><TableCell>{order.delivery ? <><strong>{order.delivery.name || "성명 누락"}</strong><small>{order.delivery.phone || "연락처 누락"}</small></> : <span className="v2-muted">—</span>}</TableCell><TableCell><StatusBadge status={order.status} /></TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label={`${order.instagramId} 상세 열기`}><ChevronRight /></Button></TableCell></TableRow>; })}</TableBody>
        </Table>
        {!filtered.length ? <div className="v2-empty-row">{currentBroadcast.orders.length ? "조건에 맞는 주문이 없습니다." : "정산 주문을 분석하면 주문 목록이 여기에 표시됩니다."}</div> : null}
      </div>
    </section>

    <Dialog open={orderOpen} onOpenChange={setOrderOpen}><DialogContent><DialogHeader><DialogTitle>신규 주문서 등록</DialogTitle><DialogDescription>카카오톡 주문서 내용을 그대로 붙여넣어 주세요.</DialogDescription></DialogHeader><Textarea className="v2-order-dialog-input" value={currentBroadcast.orderDraft} onChange={(event) => commit((current) => saveDraft(current, currentBroadcast.id, "orderDraft", event.target.value))} placeholder={"인스타 아이디: sample.user\n성함: 홍길동\n주소: 서울시 ...\n연락처: 01000000000"} /><DialogFooter><Button variant="outline" onClick={() => setOrderOpen(false)}>취소</Button><Button disabled={!currentBroadcast.orderDraft.trim()} onClick={runOrder}>주문서 등록</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>이 방송을 삭제할까요?</DialogTitle><DialogDescription>방송에 포함된 정산과 주문도 함께 삭제되며 되돌릴 수 없습니다.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>취소</Button><Button variant="destructive" onClick={remove}><Trash2 data-icon="inline-start" />방송 삭제</Button></DialogFooter></DialogContent></Dialog>
    {selected ? <OrderDrawer broadcast={currentBroadcast} order={selected} close={() => setSelectedId(null)} /> : null}
  </Shell>;
}

function CustomerDrawer({ customer, close }: { customer: Customer; close: () => void }) {
  const { commit } = useDashboard(); const [delivery, setDelivery] = useState(customer.delivery); const [confirming, setConfirming] = useState(false);
  useEffect(() => { setDelivery(customer.delivery); setConfirming(false); }, [customer.id, customer.delivery]);
  return <Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent className="w-full overflow-y-auto p-7 sm:max-w-lg" showCloseButton><SheetHeader className="v2-drawer-header"><p className="v2-eyebrow">고객 정보</p><SheetTitle>{customer.instagramId}</SheetTitle><SheetDescription>최근 수정 {displayDate(customer.updatedAt)}</SheetDescription></SheetHeader><section className="v2-drawer-section"><h3>저장된 배송정보</h3><div className="v2-form-grid"><label>받는분 성명<Input value={delivery.name} onChange={(e) => setDelivery({ ...delivery, name: e.target.value })} /></label><label className="full">주소<Input value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></label><label>연락처<Input value={delivery.phone} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} /></label></div><Button className="v2-action-wide" onClick={() => commit((current) => editCustomer(current, customer.id, delivery), "고객정보를 수정했습니다.")}>고객정보 저장</Button></section><section className="v2-danger-zone"><h3>고객 저장정보 삭제</h3><p>과거 방송의 주문과 상태는 삭제되지 않습니다.</p>{confirming ? <div><Button variant="outline" onClick={() => setConfirming(false)}>취소</Button><Button variant="destructive" onClick={() => { if (commit((current) => deleteCustomer(current, customer.id), "고객 저장정보를 삭제했습니다.")) close(); }}>삭제 확정</Button></div> : <Button variant="link" className="v2-text-danger" onClick={() => setConfirming(true)}>삭제</Button>}</section></SheetContent></Sheet>;
}

function Customers() {
  const { state } = useDashboard(); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<string | null>(null);
  const customers = useMemo(() => [...state.customers].filter((c) => !query.trim() || c.instagramId.toLowerCase().includes(query.toLowerCase()) || c.delivery.name.includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [query, state.customers]);
  const customer = state.customers.find((c) => c.id === selected);
  return <Shell section="customers"><header className="v2-page-head customers"><div><h1>고객 관리</h1><p>고객별 배송 정보를 확인하고 관리합니다.</p></div><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="인스타그램 ID 또는 성명 검색" /></header><section className="v2-customer-list">{customers.length ? <div className="v2-table-wrap"><Table><TableHeader><TableRow><TableHead>인스타그램 ID</TableHead><TableHead>받는분 성명</TableHead><TableHead>연락처</TableHead><TableHead>주소</TableHead><TableHead>최근 수정</TableHead><TableHead /></TableRow></TableHeader><TableBody>{customers.map((c) => <TableRow key={c.id} onClick={() => setSelected(c.id)}><TableCell><strong>{c.instagramId}</strong></TableCell><TableCell>{c.delivery.name}</TableCell><TableCell>{c.delivery.phone}</TableCell><TableCell className="v2-address">{c.delivery.address}</TableCell><TableCell>{displayDate(c.updatedAt)}</TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label={`${c.instagramId} 상세 열기`}>›</Button></TableCell></TableRow>)}</TableBody></Table></div> : <div className="v2-empty-panel"><strong>{query ? "조건에 맞는 고객이 없습니다." : "저장된 고객 정보가 없습니다."}</strong><p>{query ? "다른 검색어로 다시 확인해 보세요." : "주문서를 등록하면 고객 배송정보가 자동으로 저장됩니다."}</p></div>}</section>{customer ? <CustomerDrawer customer={customer} close={() => setSelected(null)} /> : null}</Shell>;
}

export default function Dashboard() {
  const path = usePathname();
  const detail = path.match(/^\/broadcasts\/([^/]+)$/);
  if (path === "/customers") return <Customers />;
  if (detail) return <BroadcastDetail broadcastId={decodeURIComponent(detail[1])} />;
  return <BroadcastList />;
}

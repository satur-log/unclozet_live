"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Search, Truck } from "lucide-react";
import { saveSelection, useSelection } from "./selection";
import { availability, customerInputIssues, customerStep, groupBuyBySlug, maskAddress, maskName, maskPhone, orderByToken, trackingUrl } from "./model";
import { priceCart, type PricedCart } from "./pricing";
import { lookupPublicOrders, submitPublicOrder, useOrderByToken, usePublicGroupBuy } from "./public-store";
import { remoteAreaLabel, remoteAreaOf } from "./remote-area";
import { ClosedNotice, MissingStore, ProtoBar, StoreFrame, StoreHeader, useNow, usePreview } from "./storefront";
import type { CustomerInput, GbOrder, GroupBuy, GroupBuyState } from "./types";
import { absoluteUrl, cartLines, copyText, formatPhoneInput, longDateTime, lookupPath, orderFormPath, orderViewPath, PriceRows, ProductThumb, productPath, won } from "./ui";
import "./group-buy.css";

function CustomerFrame({ children }: { children: React.ReactNode }) {
  return <div className="gb-customer">
    <ProtoBar />
    {children}
  </div>;
}

function Loading() { return <CustomerFrame><p className="gb-center-note">불러오는 중…</p></CustomerFrame>; }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="gb-copy" onClick={() => void copyText(text).then((ok) => { if (ok) { setDone(true); window.setTimeout(() => setDone(false), 1500); } })} aria-label={`${label} 복사`}>
    {done ? <Check /> : <Copy />}{done ? "복사됨" : "복사"}
  </button>;
}

// ── C1. 주문서 ────────────────────────────────────────────

type DaumPostcodeResult = { zonecode: string; roadAddress: string; jibunAddress: string; buildingName: string };
declare global { interface Window { daum?: { Postcode: new (options: { oncomplete: (data: DaumPostcodeResult) => void }) => { open: () => void } } } }

function loadPostcodeScript(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.onload = () => window.daum?.Postcode ? resolve() : reject(new Error("postcode unavailable"));
    script.onerror = () => reject(new Error("postcode unavailable"));
    document.head.appendChild(script);
  });
}

const SUBMIT_LOG_KEY = "unclozet-gb-submit-log";
const SUBMIT_MIN_GAP_MS = 10_000;
const SUBMIT_MAX_PER_HOUR = 10;
/** 같은 기기 연속 제출 제한. 운영에서는 Turnstile + 서버 측 제한을 함께 둔다. */
function submitBlockedReason() {
  try {
    const now = Date.now();
    const log = (JSON.parse(window.localStorage.getItem(SUBMIT_LOG_KEY) ?? "[]") as number[]).filter((time) => now - time < 3_600_000);
    if (log.length && now - log[log.length - 1] < SUBMIT_MIN_GAP_MS) return "방금 주문을 제출했어요. 잠시 후 다시 시도해 주세요.";
    if (log.length >= SUBMIT_MAX_PER_HOUR) return "같은 기기에서 주문이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  } catch { /* storage unavailable: don't block */ }
  return null;
}
function recordSubmit() {
  try {
    const log = (JSON.parse(window.localStorage.getItem(SUBMIT_LOG_KEY) ?? "[]") as number[]).filter((time) => Date.now() - time < 3_600_000);
    window.localStorage.setItem(SUBMIT_LOG_KEY, JSON.stringify([...log, Date.now()]));
  } catch { /* ignore */ }
}

const emptyInput: CustomerInput = { customerName: "", phone: "", recipientName: "", recipientPhone: "", postcode: "", address: "", addressDetail: "", shippingMessage: "", depositorName: "", pin: "" };

function Field({ label, error, children, hint, full = false }: { label: string; error?: string; hint?: string; children: React.ReactNode; full?: boolean }) {
  return <label className={`gb-field ${full ? "full" : ""} ${error ? "invalid" : ""}`}><span>{label}</span>{children}{error ? <small className="error">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}

/** 주문서(결제 정보 입력). 장바구니 또는 "바로 구매"로 담은 상품을 주문한다. */
export function CheckoutPage({ slug }: { slug: string }) {
  const state = usePublicGroupBuy(slug);
  const router = useRouter();
  const preview = usePreview(slug);
  const selection = useSelection(slug);
  const cart = useMemo(() => selection?.lines ?? {}, [selection]);
  const [input, setInput] = useState<CustomerInput>(emptyInput);
  const [sameRecipient, setSameRecipient] = useState(true);
  const [depositorTouched, setDepositorTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [noticeChecked, setNoticeChecked] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInput | "cart" | "consent" | "notice", string>>>({});
  const [formError, setFormError] = useState("");
  const [changed, setChanged] = useState<PricedCart | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [postcodeUnavailable, setPostcodeUnavailable] = useState(false);
  const now = useNow();

  const groupBuy = state ? groupBuyBySlug(state, slug) : null;
  const priced = useMemo(() => groupBuy ? priceCart(groupBuy, cartLines(cart), input.postcode, input.address) : null, [groupBuy, cart, input.postcode, input.address]);
  if (!state) return <Loading />;
  if (!groupBuy || !priced) return <MissingStore />;
  const gb = groupBuy;
  const open = availability(gb, now);
  const canOrder = open.orderable || (preview && open.reason === "draft");
  const remoteArea = remoteAreaOf(input.postcode, input.address);

  function set<K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) {
    setInput((current) => {
      const next = { ...current, [key]: value };
      if (key === "customerName" && !depositorTouched) next.depositorName = String(value);
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function searchAddress() {
    try {
      await loadPostcodeScript();
      new window.daum!.Postcode({ oncomplete: (data) => { setInput((current) => ({ ...current, postcode: data.zonecode, address: data.roadAddress || data.jibunAddress })); setErrors((current) => ({ ...current, address: undefined })); } }).open();
    } catch {
      setPostcodeUnavailable(true);
      setErrors((current) => ({ ...current, address: "주소 검색을 불러오지 못했어요. 주소를 직접 입력해 주세요(우편번호는 알면 적어주세요)." }));
    }
  }

  function payload(): CustomerInput {
    return sameRecipient ? { ...input, recipientName: input.customerName, recipientPhone: input.phone } : input;
  }

  function submit(expectedTotal: number) {
    setFormError("");
    const data = payload();
    const issues: typeof errors = { ...customerInputIssues(data) };
    if (sameRecipient) { delete issues.recipientName; delete issues.recipientPhone; }
    // 제주·도서산간 배송비를 우편번호로 계산하므로 주소 검색이 되는 동안은 우편번호를 받는다.
    // 주소 검색을 불러오지 못했으면 우편번호 없이도 주문할 수 있다(외부 API가 주문을 막지 않게).
    if (!issues.address && !postcodeUnavailable && !/^\d{5}$/.test(data.postcode.trim())) issues.address = "주소 검색으로 우편번호를 입력해 주세요.";
    if (!priced!.items.length) issues.cart = "상품을 1개 이상 담아주세요.";
    if (!consent) issues.consent = "개인정보 수집·이용에 동의해 주세요.";
    if (gb.checkoutNotice.trim() && !noticeChecked) issues.notice = "주문 전 안내를 확인해 주세요.";
    setErrors(issues);
    if (Object.values(issues).some(Boolean)) { setFormError("입력하지 않은 항목이 있어요."); return; }
    const blocked = submitBlockedReason();
    if (blocked) { setFormError(blocked); return; }
    setSubmitting(true);
    // 금액·주문번호는 서버가 다시 계산한다. 고객 공개 전에 여기에 Turnstile(봇 차단) 토큰을 붙인다.
    void submitPublicOrder({ groupBuyId: gb.id, lines: cartLines(cart), input: data, expectedTotal, source: "form" }).then((result) => {
      setSubmitting(false);
      if (result.ok) {
        recordSubmit();
        saveSelection(slug, null);
        router.push(`${orderViewPath(result.order.lookupToken)}?new=1`);
        return;
      }
      if (result.code === "PRICE_CHANGED" && "priced" in result && result.priced) { setChanged(result.priced); return; }
      setFormError(result.message);
    });
  }

  if (!priced.items.length) return <StoreFrame groupBuy={gb} preview={preview} open={open} back={orderFormPath(slug)} title="주문서"><div className="gb-view-page"><div className="gb-closed"><strong>주문할 상품이 없어요</strong><p>상품 상세에서 옵션을 고른 뒤 구매하기를 눌러주세요.</p><Link href={orderFormPath(slug)}>상품 보러 가기</Link></div></div></StoreFrame>;

  return <StoreFrame groupBuy={gb} preview={preview} open={open} back={selection ? productPath(slug, selection.productId) : orderFormPath(slug)} title="주문서">
    <article className="gb-form-page gb-shop gb-checkout">
      {!canOrder ? <ClosedNotice groupBuy={gb} reason={open.reason} /> : <form onSubmit={(event) => { event.preventDefault(); submit(priced.total); }} noValidate>
        <section className="gb-card">
          <div className="gb-card-head"><h2>주문 상품 {priced.quantity}개</h2>{selection ? <Link className="gb-link" href={productPath(slug, selection.productId)}>옵션 변경</Link> : null}</div>
          <ul className="gb-checkout-items">{priced.items.map((item) => { const product = gb.products.find((p) => p.options.some((o) => o.id === item.optionId)); return <li key={item.optionId}>
            {product?.images[0] ? <img src={product.images[0]} alt="" /> : <ProductThumb name={item.productName} imageUrl="" size={56} />}
            <div><strong>{item.itemName ?? item.optionName} × {item.quantity}</strong><span>{item.productName} · {won(item.unitPrice)}</span></div><b>{won(item.lineTotal)}</b>
          </li>; })}</ul>
          {errors.cart ? <p className="gb-error">{errors.cart}</p> : null}
        </section>

        <section className="gb-card">
          <h2>주문자 정보</h2>
          <div className="gb-fields">
            <Field label="주문자명" error={errors.customerName}><input value={input.customerName} onChange={(e) => set("customerName", e.target.value)} autoComplete="name" /></Field>
            <Field label="휴대폰 번호" error={errors.phone}><input value={input.phone} onChange={(e) => set("phone", formatPhoneInput(e.target.value))} inputMode="numeric" autoComplete="tel" placeholder="010-0000-0000" /></Field>
          </div>
        </section>

        <section className="gb-card">
          <h2>배송지</h2>
          <label className="gb-check"><input type="checkbox" checked={sameRecipient} onChange={(e) => setSameRecipient(e.target.checked)} />주문자와 받는 분이 같아요</label>
          <div className="gb-fields">
            {!sameRecipient ? <>
              <Field label="받는 분" error={errors.recipientName}><input value={input.recipientName} onChange={(e) => set("recipientName", e.target.value)} /></Field>
              <Field label="받는 분 연락처" error={errors.recipientPhone}><input value={input.recipientPhone} onChange={(e) => set("recipientPhone", formatPhoneInput(e.target.value))} inputMode="numeric" placeholder="010-0000-0000" /></Field>
            </> : null}
            <Field label="주소" error={errors.address} full>
              <div className="gb-address-row"><input className="postcode" value={input.postcode} onChange={(e) => { set("postcode", e.target.value.replace(/\D/g, "").slice(0, 5)); setErrors((current) => ({ ...current, address: undefined })); }} placeholder="우편번호" inputMode="numeric" aria-label="우편번호" /><button type="button" className="gb-secondary" onClick={() => void searchAddress()}><Search />주소 검색</button></div>
              <input value={input.address} onChange={(e) => set("address", e.target.value)} placeholder="기본 주소" autoComplete="street-address" />
              <input value={input.addressDetail} onChange={(e) => set("addressDetail", e.target.value)} placeholder="상세 주소 (동·호수)" />
            </Field>
            <Field label="배송 메시지 (선택)" full><input value={input.shippingMessage} onChange={(e) => set("shippingMessage", e.target.value)} placeholder="예: 문 앞에 놓아주세요" /></Field>
          </div>
        </section>

        <section className="gb-card">
          <h2>입금·조회 정보</h2>
          <div className="gb-fields">
            <Field label="입금자명" error={errors.depositorName} hint="은행 이체 시 표시되는 이름과 같게 적어주세요."><input value={input.depositorName} onChange={(e) => { setDepositorTouched(true); set("depositorName", e.target.value); }} /></Field>
            <Field label="조회용 비밀번호 (숫자 4자리)" error={errors.pin} hint="주문 조회할 때 휴대폰 번호와 함께 써요."><input value={input.pin} onChange={(e) => set("pin", e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" autoComplete="off" maxLength={4} /></Field>
          </div>
        </section>

        {gb.checkoutNotice.trim() ? <section className="gb-card gb-checkout-notice">
          <h2>주문 전 꼭 확인해 주세요</h2>
          <label className="gb-check"><input type="checkbox" checked={noticeChecked} onChange={(e) => { setNoticeChecked(e.target.checked); setErrors((current) => ({ ...current, notice: undefined })); }} /><span><b>[필수]</b> {gb.checkoutNotice}</span></label>
          {errors.notice ? <p className="gb-error">{errors.notice}</p> : null}
        </section> : null}

        <section className="gb-card gb-consent">
          <label className="gb-check"><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((current) => ({ ...current, consent: undefined })); }} /><span><b>[필수]</b> 개인정보 수집·이용에 동의합니다</span></label>
          <details><summary>내용 보기</summary><ul>
            <li>수집 항목: 주문자명, 휴대폰 번호, 받는 분 성함·연락처, 주소, 입금자명</li>
            <li>이용 목적: 주문 확인, 입금 확인, 상품 배송, 주문 조회</li>
            <li>보관 기간: 주문·입금·발송 기록 5년(전자상거래법), 주소·연락처 등 배송 정보는 발송 후 3개월 뒤 가림 처리</li>
            <li>동의를 거부할 수 있으나, 이 경우 주문할 수 없습니다.</li>
          </ul></details>
          {errors.consent ? <p className="gb-error">{errors.consent}</p> : null}
          <p className="gb-turnstile">🛡️ 로봇 확인(Cloudflare Turnstile) 자리 · 프로토타입에서는 생략</p>
        </section>

        <section className="gb-card"><h2>결제 금액</h2><PriceRows {...priced} />{gb.remoteShippingFee ? remoteArea ? <p className="gb-help gb-remote-note">{remoteAreaLabel(remoteArea)} 지역 주소라 배송비 {won(priced.shippingFee)}이 적용됐어요.</p> : <p className="gb-help">제주·도서산간 주소는 배송비 {won(gb.remoteShippingFee)}이 자동으로 적용돼요.</p> : null}<p className="gb-help">무통장 입금 · 주문 완료 화면에서 입금 계좌를 안내해 드려요.</p></section>

        <div className="gb-sticky" role="region" aria-label="결제 금액">
          <div className="gb-sticky-row">
            <div><span>{priced.quantity ? `${priced.quantity}개 · 상품 ${won(priced.subtotal)} + 배송 ${won(priced.shippingFee)}${priced.discount ? ` − 할인 ${won(priced.discount)}` : ""}` : "상품을 골라주세요"}</span><strong>{won(priced.total)}</strong></div>
            <button type="submit" disabled={submitting || !canOrder}>{submitting ? "확인 중…" : `${won(priced.total)} 주문하기`}</button>
          </div>
          {formError ? <p className="gb-error" role="alert">{formError}</p> : null}
        </div>
      </form>}
    </article>

    {changed ? <div className="gb-modal" role="dialog" aria-modal="true" aria-labelledby="gb-changed-title"><div>
      <h2 id="gb-changed-title">금액이 바뀌었어요</h2>
      <p>주문하는 사이 가격 또는 배송비가 변경되었어요. 아래 금액으로 주문할까요?</p>
      <ul className="gb-summary-items">{changed.items.map((item) => <li key={item.optionId}><span>{item.productName} · {item.optionName} × {item.quantity}</span><b>{won(item.lineTotal)}</b></li>)}</ul>
      <PriceRows {...changed} />
      <div className="gb-modal-actions"><button type="button" className="gb-secondary" onClick={() => setChanged(null)}>다시 고를게요</button><button type="button" onClick={() => { const total = changed.total; setChanged(null); submit(total); }}>{won(changed.total)}으로 주문</button></div>
    </div></div> : null}
  </StoreFrame>;
}

// ── C2·C3. 주문 카드 ─────────────────────────────────────

const steps = [["received", "주문 접수"], ["paid", "입금 확인"], ["shipped", "발송"]] as const;

function OrderCard({ order, groupBuy, showPayment = true }: { order: GbOrder; groupBuy: GroupBuy | undefined; showPayment?: boolean }) {
  const step = customerStep(order);
  const stepIndex = steps.findIndex(([key]) => key === step);
  return <article className={`gb-order-card ${step}`}>
    <header><div><p className="gb-eyebrow">{groupBuy?.title ?? "공구"}</p><h2>{order.orderNo}</h2><small>{longDateTime(order.createdAt)} 주문</small></div>{step === "cancelled" ? <span className="gb-pill cancelled">취소됨</span> : null}</header>
    {step !== "cancelled" ? <ol className="gb-steps" aria-label="진행 단계">{steps.map(([key, label], index) => <li key={key} className={index < stepIndex ? "done" : index === stepIndex ? "current" : ""} aria-current={index === stepIndex ? "step" : undefined}><i>{index < stepIndex ? <Check /> : index + 1}</i>{label}</li>)}</ol> : null}

    {order.sellerNote && step !== "cancelled" ? <div className="gb-seller-note"><b>판매자 안내</b><p>{order.sellerNote}</p></div> : null}
    {step === "received" && showPayment && groupBuy ? <section className="gb-pay">
      <div className="gb-pay-row"><span>입금하실 금액</span><strong>{won(order.total)}</strong><CopyButton text={String(order.total)} label="입금액" /></div>
      <div className="gb-pay-row"><span>{groupBuy.bankName} · {groupBuy.bankHolder}</span><strong className="mono">{groupBuy.bankAccount}</strong><CopyButton text={groupBuy.bankAccount.replace(/\D/g, "")} label="계좌번호" /></div>
      <p className="gb-depositor">입금자명을 <b>{order.depositorName}</b>(으)로 해주세요</p>
    </section> : null}

    {step === "shipped" ? <section className="gb-tracking"><Truck /><div><span>{order.courier}</span><strong className="mono">{order.trackingNo}</strong></div><a href={trackingUrl(order.courier, order.trackingNo)} target="_blank" rel="noreferrer">배송 조회<ExternalLink /></a></section> : null}
    {step === "paid" ? <p className="gb-step-note">입금이 확인되었어요. 발송되면 송장번호가 여기에 표시돼요.</p> : null}

    <details className="gb-order-detail" open={step === "received"}>
      <summary>주문 내역 · {won(order.total)}</summary>
      <ul className="gb-summary-items">{order.items.map((item) => <li key={item.optionId}><span>{item.itemName ?? `${item.productName} · ${item.optionName}`} × {item.quantity}</span><b>{won(item.lineTotal)}</b></li>)}</ul>
      <PriceRows subtotal={order.subtotal} shippingFee={order.shippingFee} discount={order.discount} total={order.total} />
      <dl className="gb-ship-to"><div><dt>받는 분</dt><dd>{maskName(order.recipientName)} · {maskPhone(order.recipientPhone)}</dd></div><div><dt>배송지</dt><dd>{maskAddress(order.address)}</dd></div></dl>
    </details>
  </article>;
}

export function OrderViewPage({ token }: { token: string }) {
  const state = useOrderByToken(token);
  const isNew = useSearchParams().get("new") === "1";
  if (!state) return <Loading />;
  const order = orderByToken(state, token);
  if (!order) return <CustomerFrame><StoreHeader title="주문 상세" /><div className="gb-view-page gb-shop"><div className="gb-closed"><strong>주문을 찾을 수 없어요</strong><p>링크를 다시 확인하거나 휴대폰 번호로 조회해 주세요.</p><Link href={lookupPath()}>주문 조회</Link></div></div></CustomerFrame>;
  const groupBuy = state.groupBuys.find((item) => item.id === order.groupBuyId);
  const link = absoluteUrl(orderViewPath(order.lookupToken));
  return <CustomerFrame><StoreHeader groupBuy={groupBuy} title={isNew ? "주문 완료" : "주문 상세"} back={isNew ? undefined : lookupPath()} /><div className="gb-view-page gb-shop">
    {isNew ? <header className="gb-done"><span><Check /></span><h1>주문이 접수되었어요</h1><p>아래 계좌로 입금하시면 판매자가 확인 후 발송해요.</p></header> : null}
    <OrderCard order={order} groupBuy={groupBuy} />
    {groupBuy?.completionNotice.trim() && !order.cancelledAt ? <ul className="gb-completion-notice">{groupBuy.completionNotice.split("\n").filter((line) => line.trim()).map((line) => <li key={line}>{line}</li>)}<li>주문 진행과 송장은 ‘주문 조회’에서 휴대폰 번호와 비밀번호로 확인할 수 있어요.</li></ul> : null}
    <section className="gb-card gb-bookmark">
      <h2>이 주문 전용 조회 링크</h2>
      <p>이 링크를 즐겨찾기하거나 저장해 두면 언제든 진행 상황을 확인할 수 있어요. 링크를 다른 사람과 공유하지 마세요.</p>
      <div className="gb-link-box"><code>{link}</code><CopyButton text={link} label="조회 링크" /></div>
      <Link className="gb-link" href={lookupPath()}>휴대폰 번호로 전체 주문 조회 →</Link>
    </section>
    {groupBuy && isNew ? <Link className="gb-link center" href={orderFormPath(groupBuy.slug)}>공구 홈으로</Link> : null}
  </div></CustomerFrame>;
}

export function LookupPage() {
  const [phone, setPhone] = useState(""); const [pin, setPin] = useState("");
  const [result, setResult] = useState<GroupBuyState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (!/^\d{4}$/.test(pin)) { setMessage("비밀번호 숫자 4자리를 입력하세요."); return; }
    setBusy(true);
    const outcome = await lookupPublicOrders(phone, pin);
    setBusy(false);
    if (!outcome.ok) { setResult(null); setMessage(outcome.lockedUntil ? `${outcome.message} (${longDateTime(outcome.lockedUntil)} 이후 다시 시도)` : outcome.message); return; }
    setResult(outcome.state);
  }
  const state = result;
  const orders = result?.orders ?? [];
  return <CustomerFrame><StoreHeader title="주문 조회" back="/" lookupLink={false} /><div className="gb-view-page gb-shop">
    <header className="gb-lookup-head"><h1>주문 조회</h1><p>주문할 때 입력한 휴대폰 번호와 조회 비밀번호로 확인하세요.</p></header>
    <form className="gb-lookup-form" onSubmit={run}>
      <Field label="휴대폰 번호"><input value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} inputMode="numeric" placeholder="010-0000-0000" autoComplete="tel" /></Field>
      <Field label="조회 비밀번호 4자리"><input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" maxLength={4} /></Field>
      <button type="submit" disabled={busy}>{busy ? "조회 중…" : "조회하기"}</button>
      {message ? <p className="gb-error" role="alert">{message}</p> : null}
      <p className="gb-help">비밀번호를 잊으셨나요? 블로그 안부글로 판매자에게 문의해 주세요. 확인 후 재설정해 드려요.</p>
    </form>
    {state ? <section className="gb-lookup-results" aria-live="polite"><h2>주문 {orders.length}건</h2>{orders.map((order) => <OrderCard key={order.id} order={order} groupBuy={state.groupBuys.find((item) => item.id === order.groupBuyId)} />)}</section> : null}
  </div></CustomerFrame>;
}

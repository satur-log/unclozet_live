"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { availability, groupBuyBySlug } from "./model";
import { findOption, isSoldOut, priceCart } from "./pricing";
import { saveSelection, useSelection, type Cart } from "./selection";
import { SizeChartView } from "./size-chart";
import { useGroupBuyState } from "./store";
import { ClosedNotice, MissingStore, ProtoBar, StoreFrame, priceRange, useNow, usePreview } from "./storefront";
import type { GbProduct, GroupBuy, VariantAxis } from "./types";
import { cartLines, checkoutPath, longDateTime, orderFormPath, ProductThumb, productPath, won } from "./ui";
import { attrsOf, axesFor, axisState, normalizeSelection, resolveOption, type Selection } from "./variants";
import "./group-buy.css";

// 상품 상세: 왼쪽 갤러리 / 오른쪽 옵션 선택, 아래 상품정보·사이즈·안내 탭.
// 고객은 종류 → 기장 → 사이즈 → 컬러를 고르면(컬러에서 자동으로 담김) 여러 벌을 담은 뒤 구매하기로 주문서에 간다.
// 모바일(899px 이하)은 옵션을 본문에 두지 않고, 하단 구매하기를 누르면 올라오는 바텀시트에서 고른다.

const MOBILE_QUERY = "(max-width: 899px)";
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** 아래에서 올라오는 옵션 시트. 바깥·X·Esc·아래로 끌기로 닫는다. 열려 있는 동안 뒤 화면 스크롤을 막는다. */
function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  const dragHandlers = {
    onTouchStart: (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; },
    onTouchMove: (e: React.TouchEvent) => { if (startY.current != null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); },
    onTouchEnd: () => { if (drag > 80) onClose(); setDrag(0); startY.current = null; },
  };
  return <div className="gb-sheet-layer">
    <div className="gb-sheet-backdrop" onClick={onClose} aria-hidden="true" />
    <div className="gb-sheet" role="dialog" aria-modal="true" aria-label="옵션 선택" style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
      <div className="gb-sheet-head" {...dragHandlers}>
        <span className="gb-sheet-handle" aria-hidden="true" />
        <button type="button" className="gb-sheet-close" aria-label="닫기" onClick={onClose}><X /></button>
      </div>
      <div className="gb-sheet-body">{children}</div>
    </div>
  </div>;
}

function timeLeft(closesAt: string, now: Date) {
  const ms = new Date(closesAt).getTime() - now.getTime();
  if (ms <= 0) return "마감";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return days ? `${days}일 ${hours}시간` : hours ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function Gallery({ product }: { product: GbProduct }) {
  const images = product.images.length ? product.images : [""];
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const go = (delta: number) => setIndex((current) => (current + delta + images.length) % images.length);
  return <section className="gb-pdp-gallery" aria-label="상품 이미지">
    <div className="gb-pdp-main" onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }} onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touchX.current = null; }}>
      {images[index] ? <img src={images[index]} alt={`${product.name} 이미지 ${index + 1}`} /> : <ProductThumb name={product.name} imageUrl="" size={0} />}
      {images.length > 1 ? <>
        <button type="button" className="gb-pdp-arrow prev" aria-label="이전 이미지" onClick={() => go(-1)}><ChevronLeft /></button>
        <button type="button" className="gb-pdp-arrow next" aria-label="다음 이미지" onClick={() => go(1)}><ChevronRight /></button>
      </> : null}
    </div>
    {images.length > 1 ? <div className="gb-pdp-thumbs">{images.map((src, i) => <button key={i} type="button" className={i === index ? "active" : ""} aria-label={`이미지 ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)}>{src ? <img src={src} alt="" /> : null}</button>)}</div> : null}
  </section>;
}

/** 값별 짧은 설명은 칩 글자에 붙인다. 예: FREE(55~66) */
const chipLabel = (axis: VariantAxis, value: string) => axis.valueNotes?.[value] ? `${value}(${axis.valueNotes[value]})` : value;

function lineLabel(groupBuy: GroupBuy, product: GbProduct, optionId: string) {
  const found = findOption(groupBuy, optionId);
  if (!found) return "판매 종료된 옵션";
  if (found.product.id !== product.id) return `${found.product.name} · ${found.option.name}`;
  return product.axes.length ? axesFor(product).map((axis) => attrsOf(product, found.option)[axis.name]).join(" / ") : found.option.name;
}

export function ProductPage({ slug, productId }: { slug: string; productId: string }) {
  const state = useGroupBuyState();
  const preview = usePreview(slug);
  const now = useNow();
  const router = useRouter();
  const saved = useSelection(slug);
  const [lines, setLines] = useState<Cart>({});
  const [choice, setChoice] = useState<Selection>({});
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"info" | "size" | "guide">("info");
  const [sheetOpen, setSheetOpen] = useState(false);
  const mobile = useIsMobile();
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const optionsRef = useRef<HTMLDivElement>(null);
  const groupBuy = state ? groupBuyBySlug(state, slug) : null;
  const product = groupBuy?.products.find((item) => item.id === productId) ?? null;

  // 주문서에서 "옵션 변경"으로 돌아오면 담았던 목록을 되살린다. 단순 상품 1옵션은 1개를 미리 고른다.
  useEffect(() => {
    if (!product) return;
    setLines((current) => Object.keys(current).length ? current : saved?.productId === product.id ? saved.lines : current);
    setChoice((current) => Object.keys(current).length ? current : normalizeSelection(product, {}).selection);
  }, [product, saved]);

  if (!state) return <div className="gb-customer"><ProtoBar /><p className="gb-center-note">불러오는 중…</p></div>;
  if (!groupBuy) return <MissingStore />;
  const open = availability(groupBuy, now);
  if (!product || (groupBuy.status === "draft" && !preview)) return <StoreFrame groupBuy={groupBuy} preview={preview} open={open} back={orderFormPath(slug)}><div className="gb-view-page"><div className="gb-closed"><strong>상품을 찾을 수 없어요</strong><Link href={orderFormPath(slug)}>공구 홈으로</Link></div></div></StoreFrame>;
  const gb = groupBuy;
  const item = product;
  const canBuy = open.orderable || (preview && open.reason === "draft");
  const axes = axesFor(item);
  const resolved = resolveOption(item, choice);
  const priced = priceCart(gb, cartLines(lines));
  const others = gb.products.filter((other) => other.id !== item.id);
  const { min, max } = priceRange(item);
  const notices = gb.notices.split("\n").map((line) => line.trim()).filter(Boolean);

  function choose(axisName: string, value: string) {
    setMessage("");
    const result = normalizeSelection(item, { ...choice, [axisName]: value });
    const complete = resolveOption(item, result.selection);
    // 마지막 항목(컬러)까지 고르면 자동으로 담고, 종류만 남긴 채 다음 선택을 받는다.
    if (complete) {
      if (isSoldOut(complete)) { setMessage("품절된 조합이에요."); setChoice(result.selection); return; }
      setQty(complete.id, (lines[complete.id] ?? 0) + 1);
      const first = axes[0].name;
      setChoice(axes.length > 1 ? normalizeSelection(item, { [first]: result.selection[first] }).selection : {});
      return;
    }
    setChoice(result.selection);
  }
  function setQty(optionId: string, quantity: number) {
    const found = findOption(gb, optionId);
    if (!found) return;
    // 재고가 모자라도 주문은 받는다(판매자가 추가 발주). 품절 확정된 옵션만 막는다.
    if (quantity > 0 && isSoldOut(found.option)) { setMessage(`${lineLabel(gb, item, optionId)}은(는) 품절됐어요.`); return; }
    setMessage("");
    setLines((current) => { const next = { ...current }; if (quantity <= 0) delete next[optionId]; else next[optionId] = quantity; return next; });
  }
  function buy() {
    let next = lines;
    // 담기를 누르지 않고 바로 구매하기를 눌러도, 옵션을 다 골랐으면 그 조합 1개로 주문한다.
    if (!Object.keys(next).length && resolved && !isSoldOut(resolved)) next = { [resolved.id]: 1 };
    if (!Object.keys(next).length) { setMessage(`${axes.map((axis) => axis.name).join(" · ")}을 모두 고르고 담아주세요.`); optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    saveSelection(slug, { productId: item.id, lines: next });
    router.push(checkoutPath(slug));
  }

  function showSizeChart() {
    setSheetOpen(false);
    setTab("size");
    // 시트가 닫히며 스크롤 잠금이 풀린 뒤에 이동한다.
    window.setTimeout(() => document.getElementById("gb-pdp-tabs")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  const optionsPanel = <div className="gb-pdp-options" ref={optionsRef}>
    {axes.map((axis, index) => {
      const { locked, values } = axisState(item, index, choice);
      const isSize = item.sizeChart?.sizeAxis === axis.name;
      return <div key={axis.name} className="gb-pdp-axis">
        <div className="gb-pdp-axis-row">
          <span className="gb-pdp-axis-name">{axis.name}</span>
          <div className="gb-pdp-chips" role="radiogroup" aria-label={axis.name}>
            {values.map(({ value, exists, soldOut }) => <button key={value} type="button" role="radio" aria-checked={choice[axis.name] === value} disabled={locked || !exists || soldOut} className={`${choice[axis.name] === value ? "active" : ""} ${soldOut ? "sold-out" : ""}`} onClick={() => choose(axis.name, value)} title={locked ? `${axes[0].name}을 먼저 골라주세요` : !exists ? "없는 조합이에요" : soldOut ? "품절" : undefined}>{chipLabel(axis, value)}{soldOut ? <small>품절</small> : null}</button>)}
          </div>
        </div>
        {isSize && item.sizeChart ? <div className="gb-pdp-sizelink"><button type="button" className="gb-link" onClick={showSizeChart}>실측 사이즈 자세히</button></div> : null}
      </div>;
    })}

    {others.length ? <select className="gb-pdp-addon" value="" onChange={(e) => { if (e.target.value) setQty(e.target.value, (lines[e.target.value] ?? 0) + 1); }} aria-label="추가 상품">
      <option value="">추가 상품 (선택) · 함께 주문하면 배송비 한 번</option>
      {others.map((other) => <optgroup key={other.id} label={other.name}>{other.options.map((option) => <option key={option.id} value={option.id} disabled={isSoldOut(option)}>{option.name} · {won(option.price)}{isSoldOut(option) ? " (품절)" : ""}</option>)}</optgroup>)}
    </select> : null}

    {Object.keys(lines).length ? <ul className="gb-pdp-lines">{Object.entries(lines).map(([optionId, quantity]) => {
      const found = findOption(gb, optionId);
      return <li key={optionId}>
        <div className="gb-pdp-line-head"><span>{lineLabel(gb, item, optionId)}</span><button type="button" aria-label="삭제" onClick={() => setQty(optionId, 0)}><X /></button></div>
        <div className="gb-pdp-line-body"><div className="gb-pdp-stepper" role="group" aria-label="수량"><button type="button" aria-label="수량 빼기" disabled={quantity <= 1} onClick={() => setQty(optionId, quantity - 1)}><Minus /></button><output>{quantity}</output><button type="button" aria-label="수량 더하기" onClick={() => setQty(optionId, quantity + 1)}><Plus /></button></div><b>{won((found?.option.price ?? 0) * quantity)}</b></div>
      </li>;
    })}</ul> : null}
    {message ? <p className="gb-error" role="alert">{message}</p> : null}
    <div className="gb-pdp-total"><span>총 <b>{priced.quantity}</b>개</span><span>총 금액 <strong>{won(priced.subtotal)}</strong></span></div>
    <p className="gb-pdp-total-note">+ 배송비 {won(gb.shippingFee)}{gb.remoteShippingFee ? ` (제주·도서산간 ${won(gb.remoteShippingFee)})` : ""}</p>
    <button type="button" className="gb-pdp-buy" onClick={buy}>구매하기</button>
  </div>;

  return <StoreFrame groupBuy={gb} preview={preview} open={open} back={orderFormPath(slug)}>
    <article className="gb-pdp">
      <div className="gb-pdp-top">
        <Gallery product={item} />
        <div className="gb-pdp-info">
          <h1>{gb.products.length === 1 ? gb.title : item.name}</h1>
          {item.summary ? <p className="gb-pdp-summary">{item.summary}</p> : null}
          <p className="gb-pdp-price">{item.originalPrice && item.originalPrice > min ? <del>{won(item.originalPrice)}</del> : null}<strong>{min.toLocaleString("ko-KR")}{max > min ? "~" : ""}</strong> 원</p>
          <dl className="gb-pdp-rows">
            <div><dt>배송</dt><dd>{won(gb.shippingFee)}{gb.remoteShippingFee ? ` · 제주·도서산간 ${won(gb.remoteShippingFee)}` : ""}{gb.freeShippingThreshold != null ? ` · ${won(gb.freeShippingThreshold)} 이상 무료` : ""}</dd></div>
            <div><dt>마감</dt><dd>{longDateTime(gb.closesAt)} <b>{open.orderable ? `${timeLeft(gb.closesAt, now)} 남음` : "마감"}</b></dd></div>
            <div><dt>결제</dt><dd>무통장 입금 ({gb.bankName})</dd></div>
          </dl>
          {notices.length ? <ul className="gb-pdp-notices">{notices.map((line) => <li key={line}>{line}</li>)}</ul> : null}

          {!canBuy ? <ClosedNotice groupBuy={gb} reason={open.reason} /> : mobile ? null : optionsPanel}
        </div>
      </div>

      <nav className="gb-pdp-tabs" id="gb-pdp-tabs" role="tablist" aria-label="상품 정보">
        <button type="button" role="tab" aria-selected={tab === "info"} className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>상품정보</button>
        {item.sizeChart ? <button type="button" role="tab" aria-selected={tab === "size"} className={tab === "size" ? "active" : ""} onClick={() => setTab("size")}>사이즈</button> : null}
        <button type="button" role="tab" aria-selected={tab === "guide"} className={tab === "guide" ? "active" : ""} onClick={() => setTab("guide")}>배송·교환</button>
      </nav>
      <div className="gb-pdp-panel" role="tabpanel">
        {tab === "info" ? <div className="gb-pdp-detail">{item.detailBlocks.length ? item.detailBlocks.map((block) => block.type === "image" ? <img key={block.id} src={block.value} alt="" loading="lazy" /> : <p key={block.id}>{block.value}</p>) : <p className="gb-muted">등록된 상세정보가 없습니다.</p>}</div> : null}
        {tab === "size" && item.sizeChart ? <SizeChartView product={item} chart={item.sizeChart} selection={choice} /> : null}
        {tab === "guide" ? <div className="gb-pdp-guide">
          <h2>배송·교환·환불</h2><p>{gb.policyText || "판매자가 안내를 등록하지 않았습니다."}</p>
          <h2>입금 안내</h2><p>주문서를 제출하면 최종 입금액과 계좌({gb.bankName})를 안내해 드려요.</p>
          {notices.length ? <><h2>주문 전 확인</h2><ul>{notices.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
        </div> : null}
      </div>
      {others.length ? <section className="gb-others"><h2>이 공구의 다른 상품</h2><ul>{others.map((other) => <li key={other.id}><Link href={productPath(slug, other.id)}><div className="gb-card-image">{other.images[0] ? <img src={other.images[0]} alt="" loading="lazy" /> : <ProductThumb name={other.name} imageUrl="" size={0} />}</div><strong>{other.name}</strong></Link></li>)}</ul></section> : null}
    </article>
    {canBuy && !sheetOpen ? <div className={`gb-pdp-bar ${priced.quantity ? "" : "empty"}`}>
      {priced.quantity ? <div><span>{priced.quantity}개 담음 · + 배송비 {won(gb.shippingFee)}</span><strong>{won(priced.subtotal)}</strong></div> : null}
      <button type="button" onClick={() => setSheetOpen(true)}>구매하기</button>
    </div> : null}
    {canBuy && mobile ? <BottomSheet open={sheetOpen} onClose={closeSheet}>{optionsPanel}</BottomSheet> : null}
  </StoreFrame>;
}

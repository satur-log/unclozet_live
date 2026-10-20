"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ReceiptText } from "lucide-react";
import { availability, groupBuyBySlug, type Availability } from "./model";
import { isSoldOut } from "./pricing";
import { useGroupBuyState } from "./store";
import type { GbProduct, GroupBuy } from "./types";
import { adminPath, longDateTime, lookupPath, orderFormPath, ProductThumb, productPath, won } from "./ui";
import "./group-buy.css";

// 고객 쇼핑 화면: 공구 홈(상품 목록) → 상품 상세(옵션 선택) → 주문서(checkout, customer.tsx) → 주문 완료.
// 장바구니는 없다. 같은 공구의 다른 상품은 상세에서 "추가 상품"으로 함께 주문해 배송비를 한 번만 낸다.

export function ProtoBar() {
  return <div className="gb-proto-bar"><span>프로토타입 · 이 브라우저에만 저장</span><Link href={adminPath()}>관리자 화면 →</Link></div>;
}

/** 미리보기(?preview=1)로 들어온 판매자는 같은 탭에서 상세·장바구니로 이동해도 미리보기 상태를 유지한다. */
export function usePreview(slug: string) {
  const fromUrl = useSearchParams().get("preview") === "1";
  const [stored, setStored] = useState(false);
  useEffect(() => {
    try {
      if (fromUrl) window.sessionStorage.setItem(`gb-preview:${slug}`, "1");
      setStored(window.sessionStorage.getItem(`gb-preview:${slug}`) === "1");
    } catch { /* ignore */ }
  }, [fromUrl, slug]);
  return fromUrl || stored;
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), intervalMs); return () => window.clearInterval(timer); }, [intervalMs]);
  return now;
}

/** 쇼핑 화면 공통 상단. 공구를 모르는 화면(주문 조회)에서는 groupBuy 없이 제목만 쓴다. */
export function StoreHeader({ groupBuy, back, title, lookupLink = true }: { groupBuy?: GroupBuy | null; back?: string; title?: string; lookupLink?: boolean }) {
  const router = useRouter();
  return <header className="gb-store-header">
    {back ? <button type="button" className="gb-icon-button" aria-label="뒤로" onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}><ChevronLeft /></button> : null}
    {groupBuy ? <Link href={orderFormPath(groupBuy.slug)} className="gb-store-name">{title ?? groupBuy.title}</Link> : <span className="gb-store-name">{title}</span>}
    <nav>
      {lookupLink ? <Link href={lookupPath()} className="gb-icon-button" aria-label="주문 조회"><ReceiptText /></Link> : null}
    </nav>
  </header>;
}

export function StoreFrame({ groupBuy, preview, open, children, back, title }: { groupBuy: GroupBuy; preview: boolean; open: Availability; children: React.ReactNode; back?: string; title?: string }) {
  return <div className="gb-customer">
    <ProtoBar />
    {preview ? <div className="gb-preview-bar">관리자 미리보기 · {open.orderable ? "주문하면 실제로 저장됩니다" : "지금은 주문을 받을 수 없는 상태입니다"}</div> : null}
    <StoreHeader groupBuy={groupBuy} back={back} title={title} />
    {children}
  </div>;
}

export function MissingStore() {
  return <div className="gb-customer"><ProtoBar /><div className="gb-view-page"><div className="gb-closed"><strong>공구를 찾을 수 없어요</strong><p>주소를 다시 확인해 주세요.</p></div></div></div>;
}

export function ClosedNotice({ groupBuy, reason }: { groupBuy: GroupBuy; reason: Availability["reason"] }) {
  const text = reason === "not-open" ? `${longDateTime(groupBuy.opensAt)}에 주문이 열려요.` : reason === "sold-out" ? "준비한 수량이 모두 판매되었어요." : reason === "draft" ? "아직 준비 중인 공구예요." : "주문이 마감되었어요.";
  return <div className="gb-closed"><strong>{reason === "not-open" ? "오픈 예정" : reason === "draft" ? "준비 중" : reason === "sold-out" ? "전체 품절" : "주문 마감"}</strong><p>{text}</p><Link href={lookupPath()}>내 주문 조회하기</Link></div>;
}

// ── 가격 표시 ────────────────────────────────────────────

export function priceRange(product: GbProduct) {
  const prices = product.options.map((option) => option.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
const discountRate = (original: number | null, price: number) => original && original > price ? Math.round(((original - price) / original) * 100) : 0;
const productSoldOut = (product: GbProduct) => product.options.every(isSoldOut);

function PriceTag({ product, large = false }: { product: GbProduct; large?: boolean }) {
  const { min, max } = priceRange(product);
  const rate = discountRate(product.originalPrice, min);
  return <div className={`gb-price-tag ${large ? "large" : ""}`}>
    {product.originalPrice && rate ? <del>{won(product.originalPrice)}</del> : null}
    <div>{rate ? <em>{rate}%</em> : null}<strong>{won(min)}{max > min ? "~" : ""}</strong></div>
  </div>;
}

function dDay(closesAt: string, now: Date) {
  const ms = new Date(closesAt).getTime() - now.getTime();
  if (ms <= 0) return "마감";
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.ceil(hours))}시간 남음`;
  return `D-${Math.ceil(hours / 24)}`;
}

// ── 공구 홈 ──────────────────────────────────────────────

export function StoreHomePage({ slug }: { slug: string }) {
  const state = useGroupBuyState();
  const preview = usePreview(slug);
  const now = useNow();
  const router = useRouter();
  const groupBuy = state ? groupBuyBySlug(state, slug) : null;
  const onlyProduct = groupBuy?.products.length === 1 ? groupBuy.products[0].id : null;
  // 상품이 하나뿐인 공구는 목록 없이 바로 상세로 보낸다.
  useEffect(() => { if (onlyProduct && (groupBuy?.status !== "draft" || preview)) router.replace(productPath(slug, onlyProduct)); }, [onlyProduct, groupBuy?.status, preview, router, slug]);
  if (!state) return <div className="gb-customer"><ProtoBar /><p className="gb-center-note">불러오는 중…</p></div>;
  if (!groupBuy) return <MissingStore />;
  const open = availability(groupBuy, now);
  if (groupBuy.status === "draft" && !preview) return <StoreFrame groupBuy={groupBuy} preview={false} open={open}><div className="gb-view-page"><ClosedNotice groupBuy={groupBuy} reason="draft" /></div></StoreFrame>;
  return <StoreFrame groupBuy={groupBuy} preview={preview} open={open}>
    <div className="gb-home">
      <section className="gb-banner">
        {groupBuy.imageUrl ? <img src={groupBuy.imageUrl} alt="" /> : <div className="gb-banner-art" aria-hidden="true">{groupBuy.products.slice(0, 3).map((product) => <ProductThumb key={product.id} name={product.name} imageUrl={product.images[0] ?? ""} size={84} />)}</div>}
      </section>
      <section className="gb-home-intro">
        <div className="gb-home-badges"><span className={`gb-dday ${open.orderable ? "" : "closed"}`}>{open.orderable ? dDay(groupBuy.closesAt, now) : open.reason === "not-open" ? "오픈 예정" : "마감"}</span><span>~ {longDateTime(groupBuy.closesAt)}</span></div>
        <h1>{groupBuy.title}</h1>
        {groupBuy.description ? <p className="gb-desc">{groupBuy.description}</p> : null}
        <ul className="gb-chips">
          <li>배송비 {won(groupBuy.shippingFee)}</li>
          {groupBuy.freeShippingThreshold != null ? <li>{won(groupBuy.freeShippingThreshold)} 이상 무료배송</li> : null}
          {groupBuy.discountTiers.map((tier) => <li key={tier.minSubtotal}>{won(tier.minSubtotal)} 이상 {won(tier.amount)} 할인</li>)}
          <li>무통장 입금</li>
        </ul>
      </section>
      {!open.orderable && !(preview && open.reason === "draft") ? <ClosedNotice groupBuy={groupBuy} reason={open.reason} /> : null}
      <section className="gb-catalog">
        <h2>공구 상품 <span>{groupBuy.products.length}</span></h2>
        <ul className="gb-product-grid">{groupBuy.products.map((product) => {
          const soldOut = productSoldOut(product);
          return <li key={product.id}><Link href={productPath(slug, product.id)} className={soldOut ? "sold-out" : ""}>
            <div className="gb-card-image">{product.images[0] ? <img src={product.images[0]} alt="" loading="lazy" /> : <ProductThumb name={product.name} imageUrl="" size={0} />}{soldOut ? <span className="gb-overlay">품절</span> : null}</div>
            <strong>{product.name}</strong>
            {product.summary ? <p>{product.summary}</p> : null}
            <PriceTag product={product} />
          </Link></li>;
        })}</ul>
      </section>
    </div>
  </StoreFrame>;
}

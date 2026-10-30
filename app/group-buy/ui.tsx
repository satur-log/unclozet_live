"use client";

import { createContext, useContext } from "react";
import { Minus, Plus } from "lucide-react";
import { isSoldOut, remainingStock } from "./pricing";
import type { Cart } from "./selection";
import type { GroupBuy } from "./types";
export type { Cart } from "./selection";

export const TEST_BASE = "/test";
/** 공구 관리 주소. 대시보드(/group-buys)와 테스트 모드(/test/group-buys) 둘 다에서 열린다. */
export const adminPath = (groupBuyId?: string, base = "") => `${base}/group-buys${groupBuyId ? `/${groupBuyId}` : ""}`;
export const AdminBaseContext = createContext("");
/** 지금 열린 관리 화면 기준(대시보드 또는 /test)의 공구 관리 주소 */
export function useAdminPath() {
  const base = useContext(AdminBaseContext);
  return (groupBuyId?: string) => adminPath(groupBuyId, base);
}
export const orderFormPath = (slug: string) => `${TEST_BASE}/gb/${slug}`;
export const productPath = (slug: string, productId: string) => `${TEST_BASE}/gb/${slug}/p/${productId}`;
export const checkoutPath = (slug: string) => `${TEST_BASE}/gb/${slug}/checkout`;
export const lookupPath = () => `${TEST_BASE}/gb/lookup`;
export const orderViewPath = (token: string) => `${TEST_BASE}/gb/order/${token}`;
export const absoluteUrl = (path: string) => typeof window === "undefined" ? path : `${window.location.origin}${path}`;

export const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
export const dateTime = (value: string) => {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const longDateTime = (value: string | Date) => {
  const d = new Date(value);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function downloadBytes(bytes: Uint8Array, fileName: string) {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** 이미지가 없을 때 쓰는 자리표시. 상품명 첫 글자와 이름 기반 색. */
export function ProductThumb({ name, imageUrl, size = 64 }: { name: string; imageUrl: string; size?: number }) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  // eslint-disable-next-line @next/next/no-img-element
  if (imageUrl) return <img className="gb-thumb" src={imageUrl} alt="" style={{ width: size, height: size }} />;
  return <span className="gb-thumb" aria-hidden="true" style={{ width: size, height: size, background: `oklch(0.93 0.04 ${hue})`, color: `oklch(0.42 0.08 ${hue})` }}>{name.slice(0, 1)}</span>;
}

export const cartLines = (cart: Cart) => Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([optionId, quantity]) => ({ optionId, quantity }));

/**
 * 상품·옵션·수량 선택. 고객 주문서와 관리자 수기 등록·품목 수정이 같이 쓴다.
 * `reserved`는 이미 이 주문이 잡고 있는 수량(품목 수정 시)으로, 남은 재고에 더해 계산한다.
 */
export function CartPicker({ groupBuy, cart, onChange, compact = false, allowOverStock = false, reserved = {} }: { groupBuy: GroupBuy; cart: Cart; onChange: (cart: Cart) => void; compact?: boolean; allowOverStock?: boolean; reserved?: Cart }) {
  function set(optionId: string, quantity: number) { onChange({ ...cart, [optionId]: Math.max(0, quantity) }); }
  return <div className={`gb-picker ${compact ? "compact" : ""}`}>
    {groupBuy.products.map((product) => <section key={product.id} className="gb-product">
      <header>{!compact ? <ProductThumb name={product.name} imageUrl={product.images[0] ?? ""} /> : null}<h3>{product.name}</h3></header>
      <ul>{product.options.map((option) => {
        const quantity = cart[option.id] ?? 0;
        // 재고가 모자라도 담을 수 있다(부족분은 추가 발주). 품절 확정만 막고, 관리자는 허용 후 넣을 수 있다.
        const left = remainingStock(option) + (reserved[option.id] ?? 0);
        const short = option.stockQty == null ? 0 : Math.max(0, quantity - left);
        const soldOut = isSoldOut(option) && !allowOverStock && quantity === 0;
        return <li key={option.id} className={soldOut ? "sold-out" : ""}>
          <div className="gb-option-label"><strong>{option.name}</strong><span>{won(option.price)}</span>
            {isSoldOut(option) ? <em className="out">품절 확정</em> : option.stockQty == null ? null : short > 0 ? <em className="low">재고 부족 {short}</em> : left <= option.lowStockAlert ? <em className="low">{`${left}개 남음`}</em> : compact ? <em>남은 {left}</em> : null}
          </div>
          {soldOut ? <span className="gb-soldout">품절</span> : <div className="gb-stepper" role="group" aria-label={`${product.name} ${option.name} 수량`}>
            <button type="button" aria-label="수량 빼기" disabled={quantity <= 0} onClick={() => set(option.id, quantity - 1)}><Minus /></button>
            <output aria-live="polite">{quantity}</output>
            <button type="button" aria-label="수량 더하기" onClick={() => set(option.id, quantity + 1)}><Plus /></button>
          </div>}
        </li>;
      })}</ul>
    </section>)}
  </div>;
}

export function PriceRows({ subtotal, shippingFee, discount, total }: { subtotal: number; shippingFee: number; discount: number; total: number }) {
  return <dl className="gb-price-rows">
    <div><dt>상품 금액</dt><dd>{won(subtotal)}</dd></div>
    <div><dt>배송비</dt><dd>{shippingFee ? won(shippingFee) : subtotal ? "무료" : won(0)}</dd></div>
    {discount ? <div><dt>할인</dt><dd className="discount">−{won(discount)}</dd></div> : null}
    <div className="total"><dt>최종 입금액</dt><dd>{won(total)}</dd></div>
  </dl>;
}

/** 입력하는 동안 휴대폰 번호에 하이픈을 넣는다(01012345678 → 010-1234-5678). */
export function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

import { remoteAreaOf } from "./remote-area";
import type { CartLine, GbOption, GbOrderItem, GbProduct, GroupBuy } from "./types";

// The order form, the manual-order dialog and the order-submit "server" all
// price a cart through this one function so the totals can never disagree.

export type PricedCart = {
  items: GbOrderItem[];
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
  quantity: number;
};

export function remainingStock(option: GbOption) {
  return option.stockQty == null ? Infinity : Math.max(0, option.stockQty - option.orderedQty);
}

/** 주문을 막는 건 판매자가 확정한 품절뿐이다. */
export const isSoldOut = (option: GbOption) => Boolean(option.soldOut);

/** 재고보다 더 들어온 주문 수량 = 추가 발주가 필요한 수량. */
export const shortageOf = (option: GbOption) => option.stockQty == null ? 0 : Math.max(0, option.orderedQty - option.stockQty);

export function findOption(groupBuy: GroupBuy, optionId: string): { product: GbProduct; option: GbOption } | null {
  for (const product of groupBuy.products) {
    const option = product.options.find((item) => item.id === optionId);
    if (option) return { product, option };
  }
  return null;
}

type ShippingRules = Pick<GroupBuy, "shippingFee" | "freeShippingThreshold"> & Pick<Partial<GroupBuy>, "remoteShippingFee">;

/**
 * 배송비. 우편번호가 제주·도서산간이면 remoteShippingFee로 바꾼다.
 * 무료배송 기준을 넘긴 주문도 제주·도서산간 추가분(차액)은 받는다.
 */
export function shippingFeeFor(groupBuy: ShippingRules, subtotal: number, postcode = "", address = "") {
  if (subtotal <= 0) return 0;
  const free = groupBuy.freeShippingThreshold != null && subtotal >= groupBuy.freeShippingThreshold;
  const remote = groupBuy.remoteShippingFee != null && remoteAreaOf(postcode, address) != null;
  if (!remote) return free ? 0 : groupBuy.shippingFee;
  return free ? Math.max(0, groupBuy.remoteShippingFee! - groupBuy.shippingFee) : groupBuy.remoteShippingFee!;
}

export function discountFor(groupBuy: Pick<GroupBuy, "discountTiers">, subtotal: number) {
  return groupBuy.discountTiers.reduce((best, tier) => subtotal >= tier.minSubtotal && tier.amount > best ? tier.amount : best, 0);
}

export function totalsFor(groupBuy: ShippingRules & Pick<GroupBuy, "discountTiers">, items: GbOrderItem[], postcode = "", address = ""): PricedCart {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const shippingFee = shippingFeeFor(groupBuy, subtotal, postcode, address);
  const discount = Math.min(discountFor(groupBuy, subtotal), subtotal + shippingFee);
  return { items, subtotal, shippingFee, discount, total: subtotal + shippingFee - discount, quantity: items.reduce((sum, item) => sum + item.quantity, 0) };
}

/** 택배 엑셀 품목명. 옵션 축이 있는 상품은 조합 이름 자체가 품목명이다(예: "슬림 숏 FREE 블랙"). */
export function itemNameFor(product: GbProduct, option: GbOption) {
  return product.axes.length ? option.name : `${product.name} ${option.name}`;
}

/** Prices a cart with the group buy's current option prices. Unknown options and zero quantities are dropped. */
export function priceCart(groupBuy: GroupBuy, lines: CartLine[], postcode = "", address = ""): PricedCart {
  const items: GbOrderItem[] = [];
  for (const line of lines) {
    const found = findOption(groupBuy, line.optionId);
    const quantity = Math.floor(line.quantity);
    if (!found || !(quantity > 0)) continue;
    items.push({ optionId: found.option.id, productName: found.product.name, optionName: found.option.name, itemName: itemNameFor(found.product, found.option), unitPrice: found.option.price, quantity, lineTotal: found.option.price * quantity });
  }
  return totalsFor(groupBuy, items, postcode, address);
}

/** "얼마 더 담으면 무료배송" 안내용. 무료배송 기준이 없거나 이미 넘었으면 0. */
export function amountUntilFreeShipping(groupBuy: GroupBuy, subtotal: number) {
  if (groupBuy.freeShippingThreshold == null || subtotal <= 0) return 0;
  return Math.max(0, groupBuy.freeShippingThreshold - subtotal);
}

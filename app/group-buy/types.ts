import type { OrderStatus } from "../dashboard-v2/types";

export type GroupBuyStatus = "draft" | "open" | "closed";
export type DiscountTier = { minSubtotal: number; amount: number };

export type GbOption = {
  id: string;
  name: string;
  price: number;
  /** null = 재고를 관리하지 않는 옵션(무제한 판매) */
  stockQty: number | null;
  orderedQty: number;
  lowStockAlert: number;
  /** 옵션 축이 있는 상품에서 이 조합의 값. 예: { 종류: "슬림", 기장: "숏", 사이즈: "FREE", 컬러: "블랙" } */
  attrs?: Record<string, string>;
};
/** 고객이 순서대로 고르는 옵션 축. 예: 종류 → 기장 → 사이즈 → 컬러 */
export type VariantAxis = {
  name: string;
  values: string[];
  /** 칩 글자에 붙는 짧은 설명. 예: { FREE: "55~66" } → FREE(55~66) */
  valueNotes?: Record<string, string>;
};
/** 실측표. groupAxes(예: 종류·기장)를 고르면 sizeAxis(예: 사이즈) 값별 치수를 보여준다. */
export type SizeChart = {
  unit: string;
  note: string;
  sizeAxis: string;
  groupAxes: string[];
  measurements: string[];
  diagram: "pants" | null;
  rows: { key: Record<string, string>; values: string[] }[];
};
/** 상품 상세페이지 본문. 스마트스토어 상세처럼 글과 이미지를 순서대로 쌓는다. */
export type DetailBlock = { id: string; type: "text" | "image"; value: string };
export type GbProduct = {
  id: string;
  name: string;
  /** 목록·상세 상단의 한 줄 소개 */
  summary: string;
  /** 정가. 있으면 공구가와 할인율을 함께 보여준다. */
  originalPrice: number | null;
  /** 대표 이미지들(첫 장이 목록 썸네일) */
  images: string[];
  detailBlocks: DetailBlock[];
  /** 비어 있으면 옵션 이름 하나로 고르는 단순 상품 */
  axes: VariantAxis[];
  sizeChart: SizeChart | null;
  options: GbOption[];
};

export type GroupBuy = {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** 공구 홈 상단 배너 */
  imageUrl: string;
  /** 제주·도서산간 배송비(기본 배송비 대신). 상세에 안내만 한다. */
  remoteShippingFee?: number | null;
  /** 상품 상세의 배송·교환·환불 안내 */
  policyText: string;
  /** 상품 상세 상단 안내(한 줄에 하나) */
  notices: string;
  /** 주문 제출 전 반드시 확인받는 문구. 비우면 확인 체크박스 없음 */
  checkoutNotice: string;
  /** 주문 완료 화면 추가 안내(한 줄에 하나) */
  completionNotice: string;
  opensAt: string;
  closesAt: string;
  shippingFee: number;
  freeShippingThreshold: number | null;
  discountTiers: DiscountTier[];
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  paymentDueHours: number;
  status: GroupBuyStatus;
  products: GbProduct[];
  createdAt: string;
};

export type GbOrderItem = {
  optionId: string;
  productName: string;
  optionName: string;
  /** 택배 엑셀 품목명. 예: "슬림 숏 FREE 블랙" */
  itemName?: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type GbOrderEvent = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus | null; actor: "customer" | "admin"; note: string; createdAt: string };

export type GbOrder = {
  id: string;
  orderNo: string;
  groupBuyId: string;
  customerName: string;
  phone: string;
  recipientName: string;
  recipientPhone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  shippingMessage: string;
  depositorName: string;
  lookupPinHash: string;
  lookupToken: string;
  items: GbOrderItem[];
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
  status: OrderStatus;
  sellerNote: string;
  courier: string;
  trackingNo: string;
  source: "form" | "manual";
  exportedAt: string | null;
  paidAt: string | null;
  trackingMatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  events: GbOrderEvent[];
};

export type GbStockLog = { id: string; optionId: string; change: number; reason: "주문" | "취소" | "품목 수정" | "수동 조정"; note: string; orderId: string | null; createdAt: string };

export type LookupLock = { failures: number; lockedUntil: string | null };

export type GroupBuyState = {
  version: 1;
  groupBuys: GroupBuy[];
  orders: GbOrder[];
  stockLogs: GbStockLog[];
  orderSeq: number;
  lookupLocks: Record<string, LookupLock>;
};

export type CartLine = { optionId: string; quantity: number };

export type CustomerInput = {
  customerName: string;
  phone: string;
  recipientName: string;
  recipientPhone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  shippingMessage: string;
  depositorName: string;
  pin: string;
};

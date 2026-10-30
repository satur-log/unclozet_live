import { cancelOrder, confirmPayments, DEFAULT_POLICY, exportReadyOrders, setSellerNote, setSoldOut, setTracking, submitOrder } from "./model";
import { pantsImage, placeholderImage } from "./placeholder";
import type { CartLine, CustomerInput, DetailBlock, GbOption, GbProduct, GroupBuy, GroupBuyState, SizeChart } from "./types";

// 프로토타입 시드 데이터. 이름·전화번호·계좌는 모두 가상 값이다.
// 조회 비밀번호는 전부 1234.

const HOUR = 3_600_000;
const option = (id: string, name: string, price: number, stockQty: number | null, lowStockAlert = 5): GbOption => ({ id, name, price, stockQty, orderedQty: 0, lowStockAlert });
const text = (id: string, value: string): DetailBlock => ({ id, type: "text", value });
const image = (id: string, value: string): DetailBlock => ({ id, type: "image", value });

function product(id: string, name: string, hue: number, fields: Pick<GbProduct, "summary" | "originalPrice" | "options"> & { detail: string[] }): GbProduct {
  return {
    id, name, summary: fields.summary, originalPrice: fields.originalPrice, options: fields.options, axes: [], sizeChart: null,
    images: [placeholderImage(name, hue, "대표 이미지"), placeholderImage(name, (hue + 40) % 360, "착용 컷"), placeholderImage(name, (hue + 80) % 360, "디테일")],
    detailBlocks: fields.detail.flatMap((paragraph, index) => [text(`${id}-t${index}`, paragraph), image(`${id}-i${index}`, placeholderImage(name, (hue + index * 25) % 360, `상세 이미지 ${index + 1}`, index % 2 ? "tall" : "wide"))]),
  };
}

function person(name: string, phone: string, address: string, extra: Partial<CustomerInput> = {}): CustomerInput {
  return { customerName: name, phone, recipientName: name, recipientPhone: phone, postcode: "06236", address, addressDetail: "101동 1001호", shippingMessage: "", depositorName: name, pin: "1234", ...extra };
}

// ── 마약 팬츠 (블로그 상세 안내문을 옮긴 예시) ───────────

const PANTS_COMBOS: [string, string, string, string][] = [
  ["슬림", "숏", "FREE", "블랙"], ["슬림", "숏", "L", "블랙"], ["슬림", "롱", "FREE", "블랙"], ["슬림", "롱", "L", "블랙"], ["슬림", "슈퍼롱", "FREE", "블랙"], ["슬림", "슈퍼롱", "L", "블랙"],
  ["와이드", "숏", "FREE", "멜란지"], ["와이드", "숏", "FREE", "블랙"], ["와이드", "숏", "L", "멜란지"], ["와이드", "숏", "L", "블랙"],
  ["와이드", "롱", "FREE", "멜란지"], ["와이드", "롱", "FREE", "블랙"], ["와이드", "롱", "L", "멜란지"], ["와이드", "롱", "L", "블랙"],
  ["와이드", "슈퍼롱", "L", "멜란지"], ["와이드", "슈퍼롱", "L", "블랙"],
];
const PANTS_STOCK = 50;
const pantsOptionId = (combo: string[]) => `o-pants-${combo.map((value) => ({ 슬림: "slim", 와이드: "wide", 숏: "short", 롱: "long", 슈퍼롱: "superlong", FREE: "free", L: "l", 블랙: "black", 멜란지: "melange" })[value]).join("-")}`;

const PANTS_SIZE_CHART: SizeChart = {
  unit: "cm", sizeAxis: "사이즈", groupAxes: ["종류", "기장"], diagram: "pants",
  measurements: ["총장", "허리", "밑위", "허벅지", "힙", "밑단"],
  note: "단면 치수입니다. 측정 방법에 따라 1~2cm 오차가 있을 수 있어요.\n원단: 레이온 47 · 폴리 47 · 스판 6 (슬림·와이드 동일)\n와이드 슈퍼롱 허리는 최소~최대로 늘렸을 때 값이에요.",
  rows: ([
    ["슬림", "숏", "FREE", "92", "29", "30", "25.5", "43", "23"], ["슬림", "숏", "L", "93.5", "31", "31", "26.5", "45", "24.5"],
    ["슬림", "롱", "FREE", "99", "29", "31.5", "27", "44", "23"], ["슬림", "롱", "L", "99.5", "32", "32", "28", "46", "24.5"],
    ["슬림", "슈퍼롱", "FREE", "105", "29", "32", "26", "44", "23"], ["슬림", "슈퍼롱", "L", "108", "32", "33", "29", "47", "25"],
    ["와이드", "숏", "FREE", "90", "28", "31", "32", "52", "30"], ["와이드", "숏", "L", "91", "30", "32", "33", "54", "31"],
    ["와이드", "롱", "FREE", "97", "30", "36", "32", "54", "31"], ["와이드", "롱", "L", "98", "32", "37", "33", "56", "32"],
    ["와이드", "슈퍼롱", "L", "108", "32–61", "38", "33", "56", "32"],
  ]).map(([종류, 기장, 사이즈, ...values]) => ({ key: { 종류, 기장, 사이즈 }, values })),
};

function pantsProduct(): GbProduct {
  return {
    id: "p-pants", name: "마약 팬츠", summary: "허리 밴딩 · 신축성 좋은 데일리 팬츠", originalPrice: null,
    images: [pantsImage("black", "slim", "슬림 블랙"), pantsImage("black", "wide", "와이드 블랙"), pantsImage("melange", "wide", "와이드 멜란지")],
    axes: [
      { name: "종류", values: ["슬림", "와이드"] },
      { name: "기장", values: ["숏", "롱", "슈퍼롱"] },
      { name: "사이즈", values: ["FREE", "L"], valueNotes: { FREE: "55~66", L: "66~77" } },
      { name: "컬러", values: ["블랙", "멜란지"] },
    ],
    sizeChart: PANTS_SIZE_CHART,
    options: PANTS_COMBOS.map((combo) => {
      const id = pantsOptionId(combo);
      return { ...option(id, combo.join(" "), 25900, PANTS_STOCK, 5), attrs: { 종류: combo[0], 기장: combo[1], 사이즈: combo[2], 컬러: combo[3] } };
    }),
    detailBlocks: [
      text("pd-t1", "입어본 분들이 다시 찾는 마약 팬츠예요.\n허리 밴딩이라 편하고, 신축성이 좋아 앉았다 일어나도 무릎이 늘어나지 않아요."),
      image("pd-i1", pantsImage("black", "slim", "슬림 핏")),
      text("pd-t2", "슬림 — 다리 라인을 따라 곧게 떨어지는 핏\n와이드 — 허벅지부터 여유 있게 떨어지는 세미 부츠컷"),
      image("pd-i2", pantsImage("black", "wide", "와이드 핏")),
      image("pd-i3", pantsImage("melange", "wide", "와이드 멜란지")),
      text("pd-t3", "[소재] 레이온 47 · 폴리 47 · 스판 6\n[세탁] 찬물 단독 손세탁 · 블랙은 첫 세탁 시 물빠짐이 있을 수 있어요"),
    ],
  };
}

const PANTS_OPENED_HOURS_AGO = 96;

/** 예시 공구(마약 팬츠). 주문 없이 상품·옵션·설정만. 운영 Supabase에는 이것만 넣는다. */
export function pantsGroupBuy(now = new Date()): GroupBuy {
  return {
    id: "gb-magic-pants", slug: "pants", title: "마약 팬츠 공구 (슬림 / 와이드)",
    description: "슬림 / 와이드 두 가지 핏, 숏 · 롱 · 슈퍼롱 기장으로 준비했어요. 모든 조합 25,900원.",
    imageUrl: "", policyText: DEFAULT_POLICY,
    notices: "인스타 라이브 방송 제품과는 합배송이 안 돼요.\n종류 / 기장 / 사이즈 / 컬러를 꼭 확인하고 담아주세요. 기장별로 총장 차이가 있어요.\n자체제작 슈퍼롱 기장이 추가됐어요. 와이드 슈퍼롱은 L 사이즈만 있어요.",
    checkoutNotice: "인스타 라이브 방송 제품과 합배송이 안 되는 것과, 블랙 컬러는 처음 입거나 세탁할 때 물빠짐이 있을 수 있다는 점을 확인했어요. (어두운 색 옷과 착용하고 단독 세탁해 주세요)",
    completionNotice: "배송은 CJ대한통운으로 보내드려요.\n재고가 부족하면 입금 완료 순서대로 차례로 발송돼요.",
    // 주문 기간은 아직 미정 — 데모에서는 4일 전에 열려 3일 뒤 마감되는 것으로 둔다.
    opensAt: new Date(now.getTime() - PANTS_OPENED_HOURS_AGO * HOUR).toISOString(), closesAt: new Date(now.getTime() + 3 * 24 * HOUR).toISOString(),
    shippingFee: 3000, remoteShippingFee: 6000, freeShippingThreshold: null, discountTiers: [],
    bankName: "농협", bankAccount: "150034 56 035403", bankHolder: "김애경", paymentDueHours: 24, status: "open",
    products: [pantsProduct()], createdAt: now.toISOString(),
  };
}

export function createSeedState(now = new Date()): GroupBuyState {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
  const pants = pantsGroupBuy(now);
  let state: GroupBuyState = { version: 1, groupBuys: [pants], orders: [], stockLogs: [], orderSeq: 0, lookupLocks: {} };
  const place = (groupBuyId: string, lines: CartLine[], input: CustomerInput, hoursAgo: number, source: "form" | "manual" = "form") => {
    const result = submitOrder(state, { groupBuyId, lines, input, expectedTotal: null, source, allowOverStock: true }, at(hoursAgo));
    if (!result.ok) throw new Error(`seed: ${result.message}`);
    state = result.state;
    return result.order.id;
  };
  seedPantsDemo(pants, place, { get: () => state, set: (next) => { state = next; } }, at);

  // 예: 슬림 롱 L 블랙 1 + 와이드 숏 FREE 멜란지 1 → 25,900 × 2 + 3,000 = 54,800원
  place(pants.id, [{ optionId: pantsOptionId(["슬림", "롱", "L", "블랙"]), quantity: 1 }, { optionId: pantsOptionId(["와이드", "숏", "FREE", "멜란지"]), quantity: 1 }], person("오세린", "010-2468-1357", "경기 고양시 일산동구 중앙로 0000"), 0.5);
  const pantsPaid = place(pants.id, [{ optionId: pantsOptionId(["와이드", "슈퍼롱", "L", "블랙"]), quantity: 2 }], person("문가온", "010-1357-2468", "서울 송파구 올림픽로 000"), 0.3);
  state = confirmPayments(state, [pantsPaid], at(0.1));
  return state;
}

// ── 마약 팬츠 데모 주문 ─────────────────────────────────
// 관리자 화면 데모용. 옵션당 재고 50개, 4일 전 오픈 후 첫날 주문이 몰린 상황.
// 같은 시드로 항상 같은 주문이 만들어진다. 이름·전화번호·주소는 모두 가상 값이다.

function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍".split("");
const GIVEN = ["서연", "민준", "지우", "하윤", "도윤", "서준", "하은", "예린", "지민", "수아", "유나", "채원", "다은", "소율", "지아", "윤서", "시우", "은우", "가은", "나연", "수빈", "예준", "현우", "주원", "아린", "소윤", "은서", "다인", "하린", "지유"];
const ADDRESSES = ["서울 마포구 월드컵북로 00", "서울 성동구 왕십리로 00", "서울 노원구 동일로 0000", "경기 수원시 영통구 광교중앙로 000", "경기 용인시 수지구 포은대로 000", "경기 화성시 동탄대로 000", "인천 남동구 인하로 000", "부산 수영구 광안해변로 000", "대구 달서구 월배로 000", "대전 서구 둔산로 000", "광주 서구 상무중앙로 00", "울산 남구 삼산로 000", "경남 창원시 성산구 중앙대로 000", "충북 청주시 흥덕구 대농로 00", "전북 전주시 완산구 효자로 000", "강원 춘천시 중앙로 00", "세종 한누리대로 000"];
const MESSAGES = ["", "", "", "", "문 앞에 놓아주세요", "경비실에 맡겨주세요", "배송 전 연락 부탁드려요"];
// 재고(50)를 넘겨 주문이 들어온 조합 = 부족(추가 발주 필요). 값이 음수면 그만큼 부족.
const STOCK_DEMO = [[["와이드", "슈퍼롱", "L", "멜란지"], -4], [["슬림", "롱", "FREE", "블랙"], -3]] as const;
/** 더 못 구해 판매자가 품절로 확정한 조합 */
const SOLD_OUT_DEMO = ["와이드", "슈퍼롱", "L", "멜란지"];
// 인기 조합일수록 많이 팔린다(PANTS_COMBOS 순서).
const COMBO_WEIGHTS = [6, 5, 9, 8, 3, 3, 4, 5, 3, 4, 6, 8, 5, 7, 5, 6];

type Place = (groupBuyId: string, lines: CartLine[], input: CustomerInput, hoursAgo: number, source?: "form" | "manual") => string;

/** place()는 createSeedState의 state를 직접 갱신하므로, 상태 변경도 같은 store로 읽고 쓴다. */
function seedPantsDemo(pants: GroupBuy, place: Place, store: { get: () => GroupBuyState; set: (next: GroupBuyState) => void }, at: (hoursAgo: number) => Date) {
  const random = seededRandom(20261015);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const totalWeight = COMBO_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const pickCombo = () => { let roll = random() * totalWeight; for (let i = 0; i < PANTS_COMBOS.length; i += 1) { roll -= COMBO_WEIGHTS[i]; if (roll <= 0) return PANTS_COMBOS[i]; } return PANTS_COMBOS[0]; };
  const remaining = (optionId: string) => PANTS_STOCK - store.get().groupBuys.find((g) => g.id === pants.id)!.products[0].options.find((o) => o.id === optionId)!.orderedQty;
  const phone = () => `010-${2000 + Math.floor(random() * 7999)}-${1000 + Math.floor(random() * 8999)}`;
  const people: CustomerInput[] = [];
  const newPerson = () => {
    const name = pick(SURNAMES) + pick(GIVEN);
    const roll = random();
    const where = roll < 0.04 ? { postcode: "63309", address: "제주특별자치도 제주시 연북로 00" } : roll < 0.05 ? { postcode: "40240", address: "경북 울릉군 울릉읍 도동길 00" } : { postcode: "06236", address: pick(ADDRESSES) };
    const input = person(name, phone(), where.address, { ...where, addressDetail: `${100 + Math.floor(random() * 10)}동 ${100 * (1 + Math.floor(random() * 20)) + 1 + Math.floor(random() * 4)}호`, shippingMessage: pick(MESSAGES), depositorName: random() < 0.06 ? `${name.slice(1)}맘` : name });
    people.push(input);
    return input;
  };
  const orders: { id: string; hoursAgo: number }[] = [];
  const spread = () => Math.max(0.6, PANTS_OPENED_HOURS_AGO - 1 - (PANTS_OPENED_HOURS_AGO - 2) * random() ** 2);
  const add = (lines: CartLine[], hoursAgo: number) => {
    const input = people.length > 8 && random() < 0.06 ? pick(people) : newPerson();
    orders.push({ id: place(pants.id, lines, input, hoursAgo, random() < 0.05 ? "manual" : "form"), hoursAgo });
  };

  // 1) 무작위 주문: 오픈 직후에 몰리고 점점 줄어든다. 재고(50)를 넘지 않게 담는다.
  for (let i = 0; i < 110; i += 1) {
    const hoursAgo = spread();
    const itemCount = random() < 0.65 ? 1 : random() < 0.85 ? 2 : 3;
    const lines = new Map<string, number>();
    for (let n = 0; n < itemCount; n += 1) {
      const id = pantsOptionId(pickCombo());
      const quantity = (lines.get(id) ?? 0) + (random() < 0.85 ? 1 : 2);
      if (quantity <= remaining(id)) lines.set(id, quantity);
    }
    if (lines.size) add([...lines].map(([optionId, quantity]) => ({ optionId, quantity })), hoursAgo);
  }
  // 재고 화면 데모: 와이드 슈퍼롱 L 멜란지는 품절, 슬림 롱 FREE 블랙은 3개 남김. 이 주문들도 기간 전체에 퍼뜨린다.
  const fillTo = (hoursAgo: () => number) => {
    for (const [combo, left] of STOCK_DEMO) {
      const optionId = pantsOptionId([...combo]);
      while (remaining(optionId) > left) add([{ optionId, quantity: Math.min(remaining(optionId) - left, random() < 0.7 ? 1 : 2) }], hoursAgo());
    }
  };
  fillTo(spread);

  // 2) 상태: 오래된 주문은 입금 → 엑셀 출력 → 송장까지, 최근 주문일수록 입금 전이 많다.
  const EXPORT_AT = 30;
  const EXPORT_BATCHES = [74, 50, EXPORT_AT];
  const paidAt = new Map<string, number>();
  for (const order of orders) {
    const chance = order.hoursAgo > 30 ? 0.93 : order.hoursAgo > 8 ? 0.75 : 0.3;
    if (random() < chance) paidAt.set(order.id, Math.max(0.2, order.hoursAgo - (0.3 + random() * 8)));
  }
  let state = store.get();
  const early = [...paidAt].filter(([, hoursAgo]) => hoursAgo > EXPORT_AT).sort((a, b) => b[1] - a[1]);
  // 택배 엑셀은 며칠에 나눠 뽑은 상황(재고 탭 일자별 출고 그래프용): 3일 전 · 2일 전 · 30시간 전.
  for (const batchAt of EXPORT_BATCHES) {
    for (const [id, hoursAgo] of early) if (hoursAgo > batchAt && hoursAgo <= (EXPORT_BATCHES[EXPORT_BATCHES.indexOf(batchAt) - 1] ?? Infinity)) state = confirmPayments(state, [id], at(hoursAgo));
    state = exportReadyOrders(state, pants.id, () => undefined, at(batchAt));
  }
  // 송장: 앞의 두 번은 송장까지 등록(2건은 매칭 안 된 상황), 마지막 출력분은 아직 송장 대기 → 송장 엑셀 업로드 테스트용
  const shippedEarly = early.filter(([, hoursAgo]) => hoursAgo > EXPORT_BATCHES[1]);
  const tracked = shippedEarly.slice(0, Math.max(0, shippedEarly.length - 2));
  state = setTracking(state, tracked.map(([orderId], index) => ({ orderId, courier: "CJ대한통운", trackingNo: `6932-1211-${String(5000 + index * 11).padStart(4, "0")}` })), "excel", at(EXPORT_BATCHES[1] - 3));
  for (const [id, hoursAgo] of paidAt) if (hoursAgo <= EXPORT_AT) state = confirmPayments(state, [id], at(hoursAgo));

  // 3) 예외 몇 건: 고객 요청 취소, 입금액 부족 안내.
  const unpaid = orders.filter((order) => !paidAt.has(order.id));
  const cancelTargets = unpaid.filter((order) => order.hoursAgo > 26).slice(0, 3);
  for (const order of cancelTargets) state = cancelOrder(state, order.id, "고객 요청 취소", at(order.hoursAgo - 25));
  const noteTarget = unpaid.find((order) => order.hoursAgo < 20 && !cancelTargets.includes(order));
  if (noteTarget) state = setSellerNote(state, noteTarget.id, "25,900원 입금 확인했어요. 배송비 3,000원 추가 입금 부탁드립니다.", at(Math.max(0.1, noteTarget.hoursAgo - 2)));
  store.set(state);
  // 취소로 풀린 재고는 최근 주문으로 다시 채운다.
  fillTo(() => 1 + random() * 7);
  store.set(setSoldOut(store.get(), pants.id, pantsOptionId(SOLD_OUT_DEMO), true));
}

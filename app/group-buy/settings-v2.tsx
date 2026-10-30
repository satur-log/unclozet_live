"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, GripVertical, ImagePlus, Trash2, Type } from "lucide-react";
import { stashDeletedGroupBuy, ToastContext, useCopy, useRun } from "./admin-v2-shared";
import { deleteGroupBuy, saveGroupBuy } from "./model";
import { useRouter } from "next/navigation";
import { OptionsEditor, SizeChartEditor } from "./options-v2";
import { uploadProductImage } from "./product-editor";
import type { DetailBlock, GbProduct, GroupBuy, GroupBuyState } from "./types";
import { absoluteUrl, orderFormPath, useAdminPath, won } from "./ui";

// 공구 관리 v2 설정. 고객이 보는 순서대로 묶었다:
// 기본 정보(상세 상단) → 상품 옵션 → 상세페이지(본문·배송 안내) → 주문 안내(주문서·완료 화면·입금 계좌).
// 왼쪽 목차는 화면을 따라 내려오고, 지금 보고 있는 단계(스크롤 위치)와 클릭해서 고른 단계를 다르게 표시한다.

const newId = () => crypto.randomUUID();
const toLocalInput = (value: string) => { const d = new Date(value); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (value: string) => new Date(value).toISOString();
const toNumber = (value: string) => { const n = Number(value.replace(/[,\s원]/g, "")); return Number.isFinite(n) ? n : null; };
const move = <T,>(list: T[], from: number, to: number) => { if (to < 0 || to >= list.length || from === to) return list; const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

const SECTIONS = [
  { id: "set-basic", label: "기본 정보", hint: "상세 상단에 보이는 정보" },
  { id: "set-options", label: "상품 옵션", hint: "분류 · 조합 · 재고 · 사이즈표" },
  { id: "set-detail", label: "상세페이지", hint: "상세 본문 · 배송 안내" },
  { id: "set-order", label: "주문 안내", hint: "주문서 · 완료 화면 · 계좌" },
] as const;

// ── 목차: 스크롤 위치(current)와 클릭 선택(selected)을 따로 보여준다 ──

function SettingsNav({ dirty }: { dirty: boolean }) {
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const jumping = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const marker = window.innerHeight * 0.3;
      let active: string = SECTIONS[0].id;
      for (const section of SECTIONS) { const element = document.getElementById(section.id); if (element && element.getBoundingClientRect().top <= marker) active = section.id; }
      const first = document.getElementById(SECTIONS[0].id);
      const last = document.getElementById(SECTIONS[SECTIONS.length - 1].id);
      if (first && last) {
        const start = first.getBoundingClientRect().top + window.scrollY - marker;
        const end = last.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
        setProgress(Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(1, end - start))));
        // 페이지 끝에 닿으면 마지막 단계로 본다(마지막 섹션이 짧을 때).
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = SECTIONS[SECTIONS.length - 1].id;
      }
      setCurrent(active);
      // 목차를 눌러 이동하는 중이 아니면, 직접 스크롤해서 다른 단계로 가면 클릭 선택을 푼다.
      if (jumping.current == null) setSelected((value) => value && value !== active ? null : value);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  function go(id: string) {
    setSelected(id);
    if (jumping.current) window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => { jumping.current = null; }, 900);
    const element = document.getElementById(id);
    if (element) window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 24, behavior: "smooth" });
  }

  return <nav className="gbs-nav" aria-label="설정 목차">
    <div className="gbs-rail" aria-hidden="true"><i style={{ height: `${progress * 100}%` }} /></div>
    <ol>{SECTIONS.map((section, index) => <li key={section.id}>
      <a href={`#${section.id}`} className={`${current === section.id ? "current" : ""} ${selected === section.id ? "selected" : ""}`} aria-current={current === section.id ? "location" : undefined} onClick={(e) => { e.preventDefault(); go(section.id); }}>
        <span className="gbs-step">{index + 1}</span><span><b>{section.label}</b><small>{section.hint}</small></span>
      </a>
    </li>)}</ol>
    <p className={`gbs-nav-state ${dirty ? "dirty" : ""}`}>{dirty ? "저장하지 않은 변경이 있어요" : "모두 저장됨"}</p>
  </nav>;
}

// ── 입력 조각 ────────────────────────────────────────────

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`gbs-field ${wide ? "wide" : ""}`}><span className="gbs-label">{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function LinesPreview({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length ? <ul className="gbs-preview">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : null;
}

function AutoTextarea({ value, onChange, placeholder, minRows = 3 }: { value: string; onChange: (value: string) => void; placeholder?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const element = ref.current; if (!element) return; element.style.height = "auto"; element.style.height = `${element.scrollHeight + 2}px`; }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

/** 이미지 파일 선택 → 1200px JPEG로 줄여 서버(Supabase Storage)에 올리고 주소를 돌려준다. */
function useImagePicker(onPicked: (urls: string[]) => void) {
  const toast = useContext(ToastContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const input = <input ref={inputRef} type="file" accept="image/*" multiple className="sr-only" onChange={async (e) => {
    const files = [...(e.target.files ?? [])];
    if (!files.length) return;
    setBusy(true);
    try { onPicked(await Promise.all(files.map((file) => uploadProductImage(file)))); }
    catch (error) { toast({ message: error instanceof Error ? error.message : "이미지를 읽지 못했어요.", error: true }); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }} />;
  return { input, busy, open: () => inputRef.current?.click() };
}

// ── 대표 이미지 ──────────────────────────────────────────

function ImagesEditor({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const picker = useImagePicker((urls) => onChange([...images, ...urls]));
  const [dragging, setDragging] = useState<number | null>(null);
  return <div className="gbs-images">
    {images.map((src, index) => <figure key={`${index}-${src.slice(-16)}`} draggable onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragging != null) onChange(move(images, dragging, index)); setDragging(null); }} className={dragging === index ? "dragging" : ""}>
      <img src={src} alt={`대표 이미지 ${index + 1}`} />
      {index === 0 ? <em>대표</em> : null}
      <figcaption>
        <button type="button" aria-label="앞으로" disabled={index === 0} onClick={() => onChange(move(images, index, index - 1))}><ArrowLeft /></button>
        <button type="button" aria-label="뒤로" disabled={index === images.length - 1} onClick={() => onChange(move(images, index, index + 1))}><ArrowRight /></button>
        <button type="button" aria-label="삭제" onClick={() => onChange(images.filter((_, i) => i !== index))}><Trash2 /></button>
      </figcaption>
    </figure>)}
    <button type="button" className="gbs-add-tile" onClick={picker.open} disabled={picker.busy}><ImagePlus /><span>{picker.busy ? "처리 중…" : "사진 추가"}</span><small>여러 장 선택 가능</small></button>
    {picker.input}
  </div>;
}

// ── 상세 본문(블로그처럼 글·사진을 쌓기) ─────────────────

function BlocksEditor({ blocks, onChange }: { blocks: DetailBlock[]; onChange: (blocks: DetailBlock[]) => void }) {
  const insertAt = useRef(0);
  const picker = useImagePicker((urls) => { const at = insertAt.current; onChange([...blocks.slice(0, at), ...urls.map((value) => ({ id: newId(), type: "image" as const, value })), ...blocks.slice(at)]); });
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const addText = (at: number) => onChange([...blocks.slice(0, at), { id: newId(), type: "text", value: "" }, ...blocks.slice(at)]);
  const addImages = (at: number) => { insertAt.current = at; picker.open(); };
  const Inserter = ({ at }: { at: number }) => <div className={`gbs-insert ${at === blocks.length ? "last" : ""}`}>
    <button type="button" onClick={() => addText(at)}><Type />글</button>
    <button type="button" onClick={() => addImages(at)} disabled={picker.busy}><ImagePlus />{picker.busy ? "처리 중…" : "사진"}</button>
  </div>;

  return <div className="gbs-blocks">
    {blocks.map((block, index) => <div key={block.id}>
      <Inserter at={index} />
      <div className={`gbs-block ${block.type} ${dragging === index ? "dragging" : ""} ${over === index && dragging !== index ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(index); }} onDragLeave={() => setOver(null)} onDrop={() => { if (dragging != null) onChange(move(blocks, dragging, index)); setDragging(null); setOver(null); }}>
        <span className="gbs-grip" draggable onDragStart={() => setDragging(index)} onDragEnd={() => { setDragging(null); setOver(null); }} title="끌어서 순서 바꾸기"><GripVertical /></span>
        {block.type === "text" ? <AutoTextarea value={block.value} onChange={(value) => onChange(blocks.map((item) => item.id === block.id ? { ...item, value } : item))} placeholder="설명을 적어주세요. 줄바꿈은 그대로 보여요." minRows={2} /> : <img src={block.value} alt="" />}
        <div className="gbs-block-tools">
          <button type="button" aria-label="위로" disabled={index === 0} onClick={() => onChange(move(blocks, index, index - 1))}><ArrowLeft className="up" /></button>
          <button type="button" aria-label="아래로" disabled={index === blocks.length - 1} onClick={() => onChange(move(blocks, index, index + 1))}><ArrowRight className="down" /></button>
          <button type="button" aria-label="삭제" onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}><Trash2 /></button>
        </div>
      </div>
    </div>)}
    <Inserter at={blocks.length} />
    {!blocks.length ? <p className="gbx-help">블로그 글처럼 사진과 글을 원하는 순서로 쌓아요. 사진은 여러 장을 한 번에 고를 수 있어요.</p> : null}
    {picker.input}
  </div>;
}

// ── 설정 화면 ────────────────────────────────────────────

/** 자주 쓰지 않는 기능이라 설정 맨 아래에 작게 둔다. 지운 직후 토스트로 되돌릴 수 있다. */
function DeleteGroupBuy({ state, groupBuy }: { state: GroupBuyState; groupBuy: GroupBuy }) {
  const adminPath = useAdminPath();
  const run = useRun();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const orders = state.orders.filter((order) => order.groupBuyId === groupBuy.id).length;
  function remove() {
    const ok = run((current) => { const result = deleteGroupBuy(current, groupBuy.id); stashDeletedGroupBuy(result.removed); return result.state; });
    if (ok) router.push(adminPath());
  }
  return <div className="gbs-danger">
    {confirming ? <>
      <p><b>‘{groupBuy.title}’ 공구를 삭제할까요?</b> {orders ? `주문 ${orders}건과 재고 기록도 함께 지워지고, ` : ""}주문서 링크가 더 이상 열리지 않아요.</p>
      <div><button type="button" className="gbx-btn ghost sm" onClick={() => setConfirming(false)}>취소</button><button type="button" className="gbx-btn danger sm" onClick={remove}>삭제</button></div>
    </> : <button type="button" className="gbx-link muted" onClick={() => setConfirming(true)}>이 공구 삭제</button>}
  </div>;
}

export function SettingsV2({ state, groupBuy }: { state: GroupBuyState; groupBuy: GroupBuy }) {
  const run = useRun();
  const copy = useCopy();
  const [draft, setDraft] = useState<GroupBuy>(groupBuy);
  const [productId, setProductId] = useState(groupBuy.products[0]?.id ?? "");
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(groupBuy), [draft, groupBuy]);
  // 다른 화면(v1·주문 처리)에서 바뀐 값은, 이 화면에서 고치는 중이 아니면 따라간다.
  useEffect(() => { if (!dirty) setDraft(groupBuy); }, [groupBuy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof GroupBuy>(key: K, value: GroupBuy[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const product = draft.products.find((item) => item.id === productId) ?? draft.products[0];
  const setProduct = (change: Partial<GbProduct>) => setDraft((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, ...change } : item) }));
  const lockedIds = useMemo(() => new Set(state.orders.filter((order) => order.groupBuyId === groupBuy.id && !order.cancelledAt).flatMap((order) => order.items.map((item) => item.optionId))), [state.orders, groupBuy.id]);
  const orderCount = state.orders.filter((order) => order.groupBuyId === groupBuy.id).length;
  const numberField = (value: number | null | undefined, onValue: (value: number | null) => void, placeholder?: string) => <span className="gbs-suffix"><input value={value == null ? "" : String(value)} inputMode="numeric" placeholder={placeholder} onChange={(e) => onValue(e.target.value.trim() === "" ? null : toNumber(e.target.value))} /><em>원</em></span>;

  function save() { run((current) => saveGroupBuy(current, draft), "설정을 저장했어요. 고객 화면에 바로 반영돼요."); }

  return <form className="gbs" onSubmit={(e) => { e.preventDefault(); save(); }}>
    <SettingsNav dirty={dirty} />
    <div className="gbs-body">
      {orderCount ? <p className="gbs-note">주문 {orderCount}건이 들어와 있어요. 가격을 바꿔도 기존 주문 금액은 그대로이고, 이후 주문부터 적용돼요.</p> : null}
      {draft.products.length > 1 ? <div className="gbs-product-switch" role="tablist" aria-label="편집할 상품">
        <span>편집할 상품</span>
        {draft.products.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === product.id} className={item.id === product.id ? "active" : ""} onClick={() => setProductId(item.id)}>{item.name || "이름 없는 상품"}</button>)}
      </div> : null}

      <section id="set-basic" className="gbs-section">
        <header><span>1</span><div><h2>기본 정보</h2><p>상품 상세 상단에 보이는 정보예요.</p></div></header>
        <Field label="공구 제목" hint="상세 상단 제목" wide><input value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="한 줄 소개" hint="제목 아래 회색 글씨" wide><input value={product.summary} onChange={(e) => setProduct({ summary: e.target.value })} placeholder="예: 허리 밴딩 · 신축성 좋은 데일리 팬츠" /></Field>
        <div className="gbs-row">
          <Field label="주소 슬러그" hint="영문 소문자·숫자·하이픈">
            <span className="gbs-slug"><em>…/gb/</em><input value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} /><button type="button" className="gbx-icon-btn" title="주문서 링크 복사" aria-label="주문서 링크 복사" onClick={() => copy(absoluteUrl(orderFormPath(draft.slug)), "주문서 링크")}><Copy /></button></span>
          </Field>
          <Field label="상태">
            <span className="gbs-segment" role="radiogroup" aria-label="상태">{([["draft", "준비", "비공개"], ["open", "진행", "주문 받기"], ["closed", "마감", "주문 막기"]] as const).map(([value, label, sub]) => <button key={value} type="button" role="radio" aria-checked={draft.status === value} className={draft.status === value ? "active" : ""} onClick={() => set("status", value)}>{label}<small>{sub}</small></button>)}</span>
          </Field>
        </div>
        <div className="gbs-row">
          <Field label="주문 시작"><input type="datetime-local" value={toLocalInput(draft.opensAt)} onChange={(e) => e.target.value && set("opensAt", fromLocalInput(e.target.value))} /></Field>
          <Field label="주문 마감"><input type="datetime-local" value={toLocalInput(draft.closesAt)} onChange={(e) => e.target.value && set("closesAt", fromLocalInput(e.target.value))} /></Field>
        </div>
        <Field label="대표 이미지" hint="첫 장이 목록 썸네일 · 상세 상단에서 넘겨 볼 수 있어요 · 끌어서 순서 변경" wide><ImagesEditor images={product.images} onChange={(images) => setProduct({ images })} /></Field>
        <Field label="상품 상세 상단 안내" hint="한 줄에 하나씩 · 글머리(∙)가 붙어요" wide>
          <AutoTextarea value={draft.notices} onChange={(value) => set("notices", value)} placeholder={"예: 인스타 라이브 방송 제품과는 합배송이 안 돼요.\n종류 / 기장 / 사이즈 / 컬러를 꼭 확인하고 담아주세요."} />
          <LinesPreview text={draft.notices} />
        </Field>
        <div className="gbs-row three">
          <Field label="배송비" hint="주문 1건당">{numberField(draft.shippingFee, (value) => set("shippingFee", value ?? 0))}</Field>
          <Field label="제주·도서산간" hint="우편번호로 자동 적용">{numberField(draft.remoteShippingFee, (value) => set("remoteShippingFee", value), "없음")}</Field>
          <Field label="무료배송 기준" hint="이 금액 이상이면 무료">{numberField(draft.freeShippingThreshold, (value) => set("freeShippingThreshold", value), "없음")}</Field>
        </div>
        <details className="gbs-more" open={draft.discountTiers.length > 0}>
          <summary>구간 할인 {draft.discountTiers.length ? `${draft.discountTiers.length}개` : "(선택)"}</summary>
          {draft.discountTiers.map((tier, index) => <div key={index} className="gbs-tier">
            {numberField(tier.minSubtotal, (value) => set("discountTiers", draft.discountTiers.map((item, i) => i === index ? { ...item, minSubtotal: value ?? 0 } : item)))}<span>이상 사면</span>
            {numberField(tier.amount, (value) => set("discountTiers", draft.discountTiers.map((item, i) => i === index ? { ...item, amount: value ?? 0 } : item)))}<span>할인</span>
            <button type="button" className="gbx-icon-btn" aria-label="구간 삭제" onClick={() => set("discountTiers", draft.discountTiers.filter((_, i) => i !== index))}><Trash2 /></button>
          </div>)}
          <button type="button" className="gbx-link" onClick={() => set("discountTiers", [...draft.discountTiers, { minSubtotal: 100000, amount: 5000 }])}>+ 할인 구간 추가</button>
        </details>
      </section>

      <section id="set-options" className="gbs-section">
        <header><span>2</span><div><h2>상품 옵션</h2><p>고객이 고르는 옵션과 조합별 가격·재고예요. 조합 이름이 택배 엑셀 품목명이 돼요.</p></div></header>
        <Field label="상품명" hint="주문 내역·택배 엑셀에 쓰여요" wide><input value={product.name} onChange={(e) => setProduct({ name: e.target.value })} /></Field>
        <OptionsEditor product={product} onChange={setProduct} lockedIds={lockedIds} />
        <div className="gbs-sub"><h3>실측 사이즈표 <small>(선택)</small></h3></div>
        <SizeChartEditor product={product} onChange={setProduct} />
      </section>

      <section id="set-detail" className="gbs-section">
        <header><span>3</span><div><h2>상세페이지</h2><p>‘상품정보’ 탭과 ‘배송·교환’ 탭에 보여요.</p></div></header>
        <Field label="상세 본문" hint="블로그처럼 사진과 글을 쌓아요 · 사이사이에 바로 끼워 넣을 수 있어요" wide><BlocksEditor blocks={product.detailBlocks} onChange={(detailBlocks) => setProduct({ detailBlocks })} /></Field>
        <Field label="배송·교환·환불 안내" wide><AutoTextarea value={draft.policyText} onChange={(value) => set("policyText", value)} /></Field>
      </section>

      <section id="set-order" className="gbs-section">
        <header><span>4</span><div><h2>주문 안내</h2><p>주문서와 주문 완료 화면에 보여요.</p></div></header>
        <Field label="주문 제출 전 확인 문구" hint="입력하면 주문서에 [필수] 체크박스로 나와요 · 비우면 없음" wide><AutoTextarea value={draft.checkoutNotice} onChange={(value) => set("checkoutNotice", value)} placeholder="예: 블랙 컬러는 첫 세탁 시 물빠짐이 있을 수 있다는 점을 확인했어요." /></Field>
        <Field label="주문 완료 화면 안내" hint="한 줄에 하나씩" wide>
          <AutoTextarea value={draft.completionNotice} onChange={(value) => set("completionNotice", value)} placeholder={"예: 배송은 CJ대한통운으로 보내드려요.\n재고가 부족하면 입금 완료 순서대로 발송돼요."} />
          <LinesPreview text={draft.completionNotice} />
        </Field>
        <div className="gbs-sub"><h3>입금 계좌</h3><p className="gbx-help">주문 완료 화면에 보여요. ‘진행’으로 바꾸려면 꼭 채워야 해요.</p></div>
        <div className="gbs-row">
          <Field label="은행"><input value={draft.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="예금주"><input value={draft.bankHolder} onChange={(e) => set("bankHolder", e.target.value)} /></Field>
        </div>
        <div className="gbs-row">
          <Field label="계좌번호"><input value={draft.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
        </div>
      </section>

      <DeleteGroupBuy state={state} groupBuy={groupBuy} />
    </div>

    <div className={`gbs-savebar ${dirty ? "dirty" : ""}`}>
      <span>{dirty ? "저장하지 않은 변경이 있어요" : "모두 저장됨"}{product.options.length ? ` · 판매 조합 ${product.options.length}개 · ${won(Math.min(...product.options.map((o) => o.price)))}~` : ""}</span>
      <button type="button" className="gbx-btn ghost" disabled={!dirty} onClick={() => setDraft(groupBuy)}>되돌리기</button>
      <button type="submit" className="gbx-btn primary" disabled={!dirty}>저장</button>
    </div>
  </form>;
}

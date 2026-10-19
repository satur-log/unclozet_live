"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DetailBlock, GbOption, GbProduct } from "./types";
import { productPath } from "./ui";

const newId = () => crypto.randomUUID();
const numberOr = (value: string, fallback: number) => { const n = Number(value.replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : fallback; };
const move = <T,>(list: T[], index: number, delta: number) => { const next = [...list]; const target = index + delta; if (target < 0 || target >= next.length) return list; [next[index], next[target]] = [next[target], next[index]]; return next; };

/**
 * 프로토타입은 이미지를 localStorage에 넣으므로 업로드 시 긴 변 1200px JPEG로 줄인다.
 * 운영에서는 Supabase Storage에 올리고 URL만 저장한다.
 */
export async function imageFileToDataUrl(file: File, maxSide = 1200) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있습니다.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리하지 못했습니다.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

function ImagePicker({ onAdd, label, onError }: { onAdd: (urls: string[]) => void; label: string; onError: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList) {
    setBusy(true);
    try { onAdd(await Promise.all([...files].map((file) => imageFileToDataUrl(file)))); }
    catch (error) { onError(error instanceof Error ? error.message : "이미지를 읽지 못했습니다."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  return <div className="gb-image-picker">
    <input ref={inputRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }} />
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}><ImagePlus data-icon="inline-start" />{busy ? "처리 중…" : label}</Button>
    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="또는 이미지 URL 붙여넣기" aria-label="이미지 URL" />
    <Button type="button" variant="ghost" size="sm" disabled={!url.trim()} onClick={() => { onAdd([url.trim()]); setUrl(""); }}>추가</Button>
  </div>;
}

export function ProductEditor({ slug, product, onChange, onRemove, onError }: { slug: string; product: GbProduct; onChange: (change: Partial<GbProduct>) => void; onRemove: () => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const setOption = (optionId: string, change: Partial<GbOption>) => onChange({ options: product.options.map((option) => option.id === optionId ? { ...option, ...change } : option) });
  const setBlock = (blockId: string, value: string) => onChange({ detailBlocks: product.detailBlocks.map((block) => block.id === blockId ? { ...block, value } : block) });
  const addBlocks = (blocks: DetailBlock[]) => onChange({ detailBlocks: [...product.detailBlocks, ...blocks] });

  return <div className="gb-product-edit">
    <div className="gb-product-edit-head">
      {product.images[0] ? <img className="gb-edit-thumb" src={product.images[0]} alt="" /> : <span className="gb-edit-thumb empty" aria-hidden="true" />}
      <Input value={product.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="상품명" aria-label="상품명" />
      <a className="gb-text-link" href={`${productPath(slug, product.id)}?preview=1`} target="_blank" rel="noreferrer" title="저장한 내용 기준으로 열립니다">상세 미리보기<ExternalLink /></a>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="상품 삭제" onClick={onRemove}><Trash2 /></Button>
    </div>

    {product.axes.length ? <div className="gb-axes-summary">
      <strong>옵션 구성 (고객이 이 순서로 선택)</strong>
      <ol>{product.axes.map((axis) => <li key={axis.name}><b>{axis.name}</b> {axis.values.join(" / ")}</li>)}</ol>
      <p>판매 조합 {product.options.length}개 · 아래 표의 옵션명이 택배 엑셀 품목명입니다. 표에 없는 조합(예: 와이드 슈퍼롱 FREE)은 주문서에서 비활성화됩니다.{product.sizeChart ? ` 실측표 ${product.sizeChart.rows.length}행 등록됨.` : ""}</p>
      <p className="v2-muted">프로토타입에서는 옵션 축·실측표 편집 화면이 없습니다. 가격·재고만 아래에서 고칠 수 있어요.</p>
    </div> : null}
    <table className="gb-option-table"><thead><tr><th>{product.axes.length ? "조합 (택배 엑셀 품목명)" : "옵션명"}</th><th>공구가</th><th>재고 수량</th><th>부족 기준</th><th>주문됨</th><th /></tr></thead><tbody>{product.options.map((option) => <tr key={option.id}>
      <td>{product.axes.length ? <span className="gb-combo-name">{option.name}</span> : <Input value={option.name} onChange={(e) => setOption(option.id, { name: e.target.value })} aria-label="옵션명" />}</td>
      <td><Input value={String(option.price)} inputMode="numeric" onChange={(e) => setOption(option.id, { price: numberOr(e.target.value, option.price) })} aria-label="공구가" /></td>
      <td><Input value={option.stockQty == null ? "" : String(option.stockQty)} inputMode="numeric" placeholder="무제한" onChange={(e) => setOption(option.id, { stockQty: e.target.value.trim() === "" ? null : numberOr(e.target.value, option.stockQty ?? 0) })} aria-label="재고 수량" /></td>
      <td><Input value={String(option.lowStockAlert)} inputMode="numeric" onChange={(e) => setOption(option.id, { lowStockAlert: numberOr(e.target.value, option.lowStockAlert) })} aria-label="부족 기준" /></td>
      <td className="v2-muted">{option.orderedQty}</td>
      <td><Button type="button" variant="ghost" size="icon-sm" aria-label="옵션 삭제" onClick={() => onChange({ options: product.options.filter((item) => item.id !== option.id) })}><Trash2 /></Button></td>
    </tr>)}</tbody></table>
    {product.axes.length ? null : <button type="button" className="v2-text-button" onClick={() => onChange({ options: [...product.options, { id: newId(), name: "", price: product.options[0]?.price ?? 0, stockQty: null, orderedQty: 0, lowStockAlert: 5 }] })}>+ 옵션 추가</button>}

    <button type="button" className="gb-detail-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "▾" : "▸"} 상세페이지 <span>이미지 {product.images.length}장 · 본문 {product.detailBlocks.length}개{product.summary ? "" : " · 한 줄 소개 없음"}</span>
    </button>
    {open ? <div className="gb-detail-editor">
      <div className="v2-form-grid">
        <label className="full">한 줄 소개<Input value={product.summary} onChange={(e) => onChange({ summary: e.target.value })} placeholder="예: 까슬거림 없는 램스울 70% · 루즈핏" /></label>
        <label>정가 (선택)<Input value={product.originalPrice == null ? "" : String(product.originalPrice)} inputMode="numeric" placeholder="입력하면 할인율 표시" onChange={(e) => onChange({ originalPrice: e.target.value.trim() === "" ? null : numberOr(e.target.value, product.originalPrice ?? 0) })} /></label>
      </div>

      <h4>대표 이미지 <small>첫 장이 목록 썸네일 · 상세 상단에서 넘겨 볼 수 있어요</small></h4>
      <ul className="gb-image-list">{product.images.map((src, index) => <li key={`${index}-${src.slice(-24)}`}>
        <img src={src} alt="" />
        <div><Button type="button" variant="ghost" size="icon-xs" aria-label="앞으로" disabled={index === 0} onClick={() => onChange({ images: move(product.images, index, -1) })}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label="뒤로" disabled={index === product.images.length - 1} onClick={() => onChange({ images: move(product.images, index, 1) })}><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label="삭제" onClick={() => onChange({ images: product.images.filter((_, i) => i !== index) })}><Trash2 /></Button></div>
        {index === 0 ? <em>대표</em> : null}
      </li>)}</ul>
      <ImagePicker label="이미지 올리기" onAdd={(urls) => onChange({ images: [...product.images, ...urls] })} onError={onError} />

      <h4>상세 본문 <small>글과 이미지를 순서대로 쌓아요 (스마트스토어 상세와 같은 방식)</small></h4>
      <ol className="gb-block-list">{product.detailBlocks.map((block, index) => <li key={block.id}>
        {block.type === "text" ? <Textarea value={block.value} onChange={(e) => setBlock(block.id, e.target.value)} placeholder="설명, 사이즈, 소재, 세탁 방법 등" /> : <img src={block.value} alt="" />}
        <div><Button type="button" variant="ghost" size="icon-xs" aria-label="위로" disabled={index === 0} onClick={() => onChange({ detailBlocks: move(product.detailBlocks, index, -1) })}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label="아래로" disabled={index === product.detailBlocks.length - 1} onClick={() => onChange({ detailBlocks: move(product.detailBlocks, index, 1) })}><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label="삭제" onClick={() => onChange({ detailBlocks: product.detailBlocks.filter((item) => item.id !== block.id) })}><Trash2 /></Button></div>
      </li>)}</ol>
      <div className="gb-block-actions">
        <Button type="button" variant="outline" size="sm" onClick={() => addBlocks([{ id: newId(), type: "text", value: "" }])}><Type data-icon="inline-start" />글 추가</Button>
        <ImagePicker label="상세 이미지 올리기" onAdd={(urls) => addBlocks(urls.map((value) => ({ id: newId(), type: "image", value })))} onError={onError} />
      </div>
    </div> : null}
  </div>;
}

"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import type { GbOption, GbProduct, SizeChart, VariantAxis } from "./types";

// 공구 관리 v2 설정의 상품 옵션·실측 사이즈 편집.
// 옵션은 "분류(종류·기장·사이즈·컬러…) → 값" 순서로 만들고, 분류 값의 모든 조합이 판매 조합이 된다.
// 팔지 않을 조합은 표에서 끈다. 조합 이름(값을 순서대로 이은 것)이 택배 엑셀 품목명이다.

const newId = () => crypto.randomUUID();
const toNumber = (value: string) => { const n = Number(value.replace(/[,\s원]/g, "")); return Number.isFinite(n) ? n : null; };

type Combo = Record<string, string>;
const cartesian = (axes: VariantAxis[]): Combo[] => axes.reduce<Combo[]>((combos, axis) => combos.flatMap((combo) => axis.values.map((value) => ({ ...combo, [axis.name]: value }))), [{}]);
const comboName = (axes: VariantAxis[], combo: Combo) => axes.map((axis) => combo[axis.name]).join(" ");
const sameCombo = (axes: VariantAxis[], a: Combo | undefined, b: Combo) => !!a && axes.every((axis) => a[axis.name] === b[axis.name]);
/** 축 순서가 바뀌거나 값이 추가되면 옵션 이름(택배 품목명)을 다시 만든다. */
const renamed = (options: GbOption[], axes: VariantAxis[]) => options.map((option) => option.attrs ? { ...option, name: comboName(axes, option.attrs) } : option);

const AXIS_PRESETS = ["종류", "핏", "기장", "사이즈", "컬러", "소재"];
const VALUE_PRESETS: Record<string, string[]> = {
  종류: ["슬림", "와이드", "스트레이트"],
  핏: ["슬림", "레귤러", "와이드", "오버"],
  기장: ["숏", "롱", "슈퍼롱", "9부", "크롭"],
  사이즈: ["FREE", "S", "M", "L", "XL"],
  컬러: ["블랙", "화이트", "아이보리", "그레이", "멜란지", "네이비", "베이지", "브라운"],
  소재: ["면", "린넨", "울", "니트"],
};

export function OptionsEditor({ product, onChange, lockedIds }: { product: GbProduct; onChange: (change: Partial<GbProduct>) => void; lockedIds: Set<string> }) {
  const [pending, setPending] = useState<string[]>([]);
  const [newAxis, setNewAxis] = useState("");
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [message, setMessage] = useState("");
  const axes = product.axes;
  const ordered = (option: GbOption) => lockedIds.has(option.id) || option.orderedQty > 0;
  const hasOrders = product.options.some(ordered);
  const base = product.options[0];
  const defaults = { price: base?.price ?? 0, stockQty: base?.stockQty ?? null, lowStockAlert: base?.lowStockAlert ?? 5 };
  const legacy = !axes.length && product.options.length > 1;
  const setOption = (id: string, change: Partial<GbOption>) => onChange({ options: product.options.map((option) => option.id === id ? { ...option, ...change } : option) });
  const makeOption = (combo: Combo, nextAxes: VariantAxis[]): GbOption => ({ id: newId(), name: comboName(nextAxes, combo), ...defaults, orderedQty: 0, attrs: combo });
  /** 실측표의 키도 축 이름·삭제를 따라가게 한다. */
  const chartWith = (map: (chart: SizeChart) => SizeChart | null) => product.sizeChart ? { sizeChart: map(product.sizeChart) } : {};
  const blocked = (text: string) => { setMessage(text); return false; };

  // ── 분류 ──
  function addAxis(name: string) {
    const clean = name.trim();
    setMessage("");
    if (!clean) return;
    if (axes.some((axis) => axis.name === clean) || pending.includes(clean)) { blocked(`‘${clean}’ 분류가 이미 있어요.`); return; }
    if (hasOrders) { blocked("주문이 들어온 상품은 분류를 추가할 수 없어요. 기존 조합의 이름이 바뀌기 때문이에요."); return; }
    setPending([...pending, clean]);
    setNewAxis("");
  }
  /** 값이 처음 들어오는 순간 분류가 실제로 생긴다(값 없는 분류는 고객 화면에 못 쓰므로). */
  function addValue(axisName: string, raw: string) {
    const value = raw.trim();
    setMessage("");
    if (!value) return;
    const axis = axes.find((item) => item.name === axisName);
    if (axis) {
      if (axis.values.includes(value)) { blocked(`‘${value}’는 이미 있어요.`); return; }
      const nextAxes = axes.map((item) => item.name === axisName ? { ...item, values: [...item.values, value] } : item);
      const added = cartesian(nextAxes).filter((combo) => combo[axisName] === value).map((combo) => makeOption(combo, nextAxes));
      onChange({ axes: nextAxes, options: [...product.options, ...added] });
    } else {
      // 새 분류의 첫 값: 기존 조합마다 이 값을 붙인다(가격·재고 유지). 분류가 처음이면 기본 옵션을 이 값 하나로 바꾼다.
      const nextAxes = [...axes, { name: axisName, values: [value] }];
      const options = axes.length
        ? renamed(product.options.map((option) => ({ ...option, attrs: { ...(option.attrs ?? {}), [axisName]: value } })), nextAxes)
        : [{ ...(base ?? makeOption({}, nextAxes)), name: value, attrs: { [axisName]: value } }];
      if (legacy) { blocked("분류 없이 여러 옵션으로 만든 상품이에요. 옵션을 하나만 남기고 분류를 추가해 주세요."); return; }
      onChange({ axes: nextAxes, options });
      setPending(pending.filter((name) => name !== axisName));
    }
    setNewValues({ ...newValues, [axisName]: "" });
  }
  function removeValue(axis: VariantAxis, value: string) {
    setMessage("");
    if (axis.values.length === 1) { removeAxis(axis); return; }
    const { [value]: _removed, ...notes } = axis.valueNotes ?? {};
    onChange({
      axes: axes.map((item) => item.name === axis.name ? { ...item, values: item.values.filter((v) => v !== value), valueNotes: notes } : item),
      options: product.options.filter((option) => option.attrs?.[axis.name] !== value),
      ...chartWith((chart) => ({ ...chart, rows: chart.rows.filter((row) => row.key[axis.name] !== value) })),
    });
  }
  function removeAxis(axis: VariantAxis) {
    setMessage("");
    if (hasOrders) { blocked("주문이 들어온 상품은 분류를 뺄 수 없어요."); return; }
    const nextAxes = axes.filter((item) => item.name !== axis.name);
    // 같은 조합이 된 옵션은 하나만 남긴다(가격·재고는 먼저 있던 것 유지).
    const seen = new Set<string>();
    const options = product.options.map((option) => { const { [axis.name]: _dropped, ...attrs } = option.attrs ?? {}; return { ...option, attrs }; })
      .filter((option) => { const key = comboName(nextAxes, option.attrs); if (seen.has(key)) return false; seen.add(key); return true; });
    onChange({
      axes: nextAxes,
      options: nextAxes.length ? renamed(options, nextAxes) : [{ ...options[0], name: "기본", attrs: undefined }],
      ...chartWith((chart) => chart.sizeAxis === axis.name || !nextAxes.length ? null : { ...chart, groupAxes: chart.groupAxes.filter((name) => name !== axis.name) }),
    });
  }
  function moveAxis(index: number, delta: number) {
    if (hasOrders) return;
    const target = index + delta;
    if (target < 0 || target >= axes.length) return;
    const nextAxes = [...axes];
    [nextAxes[index], nextAxes[target]] = [nextAxes[target], nextAxes[index]];
    onChange({ axes: nextAxes, options: renamed(product.options, nextAxes) });
  }
  function renameAxis(from: string, to: string) {
    const clean = to.trim();
    setRenaming(null);
    if (!clean || clean === from || hasOrders) return;
    if (axes.some((axis) => axis.name === clean)) { blocked(`‘${clean}’ 분류가 이미 있어요.`); return; }
    const swapKey = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key === from ? clean : key, value]));
    onChange({
      axes: axes.map((axis) => axis.name === from ? { ...axis, name: clean } : axis),
      options: product.options.map((option) => option.attrs ? { ...option, attrs: swapKey(option.attrs) } : option),
      ...chartWith((chart) => ({ ...chart, sizeAxis: chart.sizeAxis === from ? clean : chart.sizeAxis, groupAxes: chart.groupAxes.map((name) => name === from ? clean : name), rows: chart.rows.map((row) => ({ ...row, key: swapKey(row.key) })) })),
    });
  }
  const setNote = (axis: VariantAxis, value: string, note: string) => onChange({ axes: axes.map((item) => item.name === axis.name ? { ...item, valueNotes: { ...(item.valueNotes ?? {}), [value]: note } } : item) });

  // ── 조합 ──
  const optionFor = (combo: Combo) => product.options.find((option) => sameCombo(axes, option.attrs, combo));
  function toggleCombo(combo: Combo, on: boolean) {
    if (on) onChange({ options: [...product.options, makeOption(combo, axes)] });
    else { const option = optionFor(combo); if (option && product.options.length > 1) onChange({ options: product.options.filter((item) => item.id !== option.id) }); }
  }
  function applyBulk(key: "price" | "stockQty", raw: string) {
    const value = raw.trim() === "" && key === "stockQty" ? null : toNumber(raw);
    if (value === null && key === "price") return;
    onChange({ options: product.options.map((option) => ({ ...option, [key]: value })) });
  }
  const numberInput = (option: GbOption, key: "price" | "stockQty" | "lowStockAlert", label: string) => <input value={option[key] == null ? "" : String(option[key])} placeholder={key === "stockQty" ? "무제한" : undefined} inputMode="numeric" aria-label={label}
    onChange={(e) => setOption(option.id, { [key]: key === "stockQty" && e.target.value.trim() === "" ? null : toNumber(e.target.value) ?? option[key] })} />;

  const axisRows = [...axes.map((axis) => ({ name: axis.name, axis })), ...pending.map((name) => ({ name, axis: null as VariantAxis | null }))];
  const suggestions = AXIS_PRESETS.filter((name) => !axisRows.some((row) => row.name === name));

  return <div className="gbs-options">
    <div className="gbs-axes">
      {axisRows.map(({ name, axis }, index) => {
        const valuePresets = (VALUE_PRESETS[name] ?? []).filter((value) => !axis?.values.includes(value));
        return <div key={name} className={`gbs-axis ${axis ? "" : "pending"}`}>
          <div className="gbs-axis-name">
            <i>{index + 1}</i>
            {renaming?.from === name ? <input className="gbs-rename" value={renaming.to} autoFocus onChange={(e) => setRenaming({ from: name, to: e.target.value })} onBlur={() => renameAxis(name, renaming.to)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameAxis(name, renaming.to); } if (e.key === "Escape") setRenaming(null); }} aria-label="분류 이름" />
              : <b>{name}</b>}
            {axis ? <span className="gbs-axis-tools">
              <button type="button" title={hasOrders ? "주문이 있는 상품은 분류 이름을 바꿀 수 없어요" : "이름 바꾸기"} aria-label={`${name} 이름 바꾸기`} disabled={hasOrders} onClick={() => setRenaming({ from: name, to: name })}><Pencil /></button>
              <button type="button" title={hasOrders ? "주문이 있는 상품은 순서를 바꿀 수 없어요 (택배 품목명이 바뀌어요)" : "위로 (먼저 고르기)"} aria-label={`${name} 위로`} disabled={hasOrders || index === 0} onClick={() => moveAxis(index, -1)}><ArrowUp /></button>
              <button type="button" title="아래로" aria-label={`${name} 아래로`} disabled={hasOrders || index >= axes.length - 1} onClick={() => moveAxis(index, 1)}><ArrowDown /></button>
              <button type="button" title={hasOrders ? "주문이 있는 상품은 분류를 뺄 수 없어요" : "분류 삭제"} aria-label={`${name} 분류 삭제`} disabled={hasOrders} onClick={() => removeAxis(axis)}><Trash2 /></button>
            </span> : <span className="gbs-axis-tools"><button type="button" aria-label={`${name} 분류 취소`} title="분류 취소" onClick={() => setPending(pending.filter((item) => item !== name))}><X /></button></span>}
          </div>
          <div className="gbs-axis-values">
            <div className="gbs-values">
              {axis?.values.map((value) => { const locked = product.options.some((option) => option.attrs?.[axis.name] === value && ordered(option)); return <span key={value} className="gbs-value">
                <b>{value}</b>
                <input value={axis.valueNotes?.[value] ?? ""} onChange={(e) => setNote(axis, value, e.target.value)} placeholder="설명" aria-label={`${value} 칩 설명`} title="칩에 괄호로 붙는 설명. 예: 55~66 → FREE(55~66)" />
                <button type="button" aria-label={`${value} 빼기`} disabled={locked || (axis.values.length === 1 && hasOrders)} title={locked ? "주문이 있는 값은 뺄 수 없어요" : `${value} 빼기`} onClick={() => removeValue(axis, value)}><X /></button>
              </span>; })}
              <span className="gbs-value-add"><input value={newValues[name] ?? ""} onChange={(e) => setNewValues({ ...newValues, [name]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addValue(name, newValues[name] ?? ""); } }} placeholder={axis ? `${name} 값 추가` : `${name} 값 입력 후 Enter`} aria-label={`${name} 값 추가`} autoFocus={!axis} /><button type="button" onClick={() => addValue(name, newValues[name] ?? "")} aria-label="값 추가"><Plus /></button></span>
            </div>
            {valuePresets.length ? <div className="gbs-presets"><span>추천</span>{valuePresets.map((value) => <button key={value} type="button" onClick={() => addValue(name, value)}>+ {value}</button>)}</div> : null}
          </div>
        </div>;
      })}
      <div className="gbs-axis add">
        <div className="gbs-axis-name"><i>+</i><b>분류 추가</b></div>
        <div className="gbs-axis-values">
          <div className="gbs-values">
            <span className="gbs-value-add wide"><input value={newAxis} onChange={(e) => setNewAxis(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAxis(newAxis); } }} placeholder="분류 이름 (예: 컬러)" aria-label="새 분류 이름" /><button type="button" onClick={() => addAxis(newAxis)} aria-label="분류 추가"><Plus /></button></span>
          </div>
          {suggestions.length ? <div className="gbs-presets"><span>추천</span>{suggestions.map((name) => <button key={name} type="button" onClick={() => addAxis(name)}>+ {name}</button>)}</div> : null}
        </div>
      </div>
    </div>
    {message ? <p className="gbx-warn">{message}</p> : null}
    <p className="gbx-help">{axes.length ? <>고객은 위에서부터 {axes.map((axis) => axis.name).join(" → ")} 순서로 골라요. 값 옆 ‘설명’은 칩에 괄호로 붙어요 (예: FREE(55~66)).</> : legacy ? "이 상품은 분류 없이 옵션 이름만으로 팔고 있어요. 아래 표에서 옵션을 고치세요." : "분류를 추가하지 않으면 한 가지 상품으로 팔아요. 사이즈·컬러처럼 고를 게 있으면 분류를 추가하세요."}</p>

    {legacy ? <LegacyOptions product={product} onChange={onChange} ordered={ordered} defaults={defaults} />
      : !axes.length ? <div className="gbs-single">
        <span>한 가지로 판매</span>
        <label>가격<span className="gbs-suffix">{base ? numberInput(base, "price", "가격") : null}<em>원</em></span></label>
        <label>재고<span className="gbs-suffix">{base ? numberInput(base, "stockQty", "재고") : null}<em>개</em></span></label>
        <label>부족 알림<span className="gbs-suffix">{base ? numberInput(base, "lowStockAlert", "부족 알림 기준") : null}<em>개</em></span></label>
      </div>
      : <>
        <div className="gbs-bulk">
          <span>판매 중인 {product.options.length}개 조합 전체에</span>
          <input value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="가격" inputMode="numeric" aria-label="일괄 가격" /><button type="button" className="gbx-btn sm" disabled={!bulkPrice.trim()} onClick={() => { applyBulk("price", bulkPrice); setBulkPrice(""); }}>가격 적용</button>
          <input value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} placeholder="재고 (비우면 무제한)" inputMode="numeric" aria-label="일괄 재고" /><button type="button" className="gbx-btn sm" onClick={() => { applyBulk("stockQty", bulkStock); setBulkStock(""); }}>재고 적용</button>
        </div>
        <div className="gbs-table-wrap"><table className="gbs-table">
          <thead><tr><th className="check">판매</th>{axes.map((axis) => <th key={axis.name}>{axis.name}</th>)}<th>가격</th><th>재고</th><th>부족 알림</th><th className="num">주문됨</th></tr></thead>
          <tbody>{cartesian(axes).map((combo) => {
            const option = optionFor(combo);
            const locked = option ? ordered(option) : false;
            return <tr key={comboName(axes, combo)} className={option ? "" : "off"}>
              <td className="check"><input type="checkbox" checked={Boolean(option)} disabled={locked || (Boolean(option) && product.options.length === 1)} title={locked ? "주문이 있는 조합은 끌 수 없어요. 재고를 0으로 두면 품절돼요." : undefined} onChange={(e) => toggleCombo(combo, e.target.checked)} aria-label={`${comboName(axes, combo)} 판매`} /></td>
              {axes.map((axis) => <td key={axis.name}>{combo[axis.name]}</td>)}
              {option ? <>
                <td>{numberInput(option, "price", "가격")}</td>
                <td>{numberInput(option, "stockQty", "재고")}</td>
                <td>{numberInput(option, "lowStockAlert", "부족 알림 기준")}</td>
                <td className="num">{option.orderedQty}</td>
              </> : <td colSpan={4} className="gbs-off-note">판매 안 함 · 고객 화면에서 비활성화돼요</td>}
            </tr>;
          })}</tbody>
        </table></div>
      </>}
  </div>;
}

/** 분류 없이 옵션 이름만 여러 개인 예전 방식 상품(예: 니트 아이보리/차콜). */
function LegacyOptions({ product, onChange, ordered, defaults }: { product: GbProduct; onChange: (change: Partial<GbProduct>) => void; ordered: (option: GbOption) => boolean; defaults: Pick<GbOption, "price" | "stockQty" | "lowStockAlert"> }) {
  const setOption = (id: string, change: Partial<GbOption>) => onChange({ options: product.options.map((option) => option.id === id ? { ...option, ...change } : option) });
  return <div className="gbs-simple">
    <table className="gbs-table"><thead><tr><th>옵션명</th><th>가격</th><th>재고</th><th>부족 알림</th><th className="num">주문됨</th><th /></tr></thead>
      <tbody>{product.options.map((option) => <tr key={option.id}>
        <td><input value={option.name} onChange={(e) => setOption(option.id, { name: e.target.value })} aria-label="옵션명" /></td>
        <td><input value={String(option.price)} inputMode="numeric" onChange={(e) => setOption(option.id, { price: toNumber(e.target.value) ?? option.price })} aria-label="가격" /></td>
        <td><input value={option.stockQty == null ? "" : String(option.stockQty)} placeholder="무제한" inputMode="numeric" onChange={(e) => setOption(option.id, { stockQty: e.target.value.trim() === "" ? null : toNumber(e.target.value) ?? option.stockQty })} aria-label="재고" /></td>
        <td><input value={String(option.lowStockAlert)} inputMode="numeric" onChange={(e) => setOption(option.id, { lowStockAlert: toNumber(e.target.value) ?? option.lowStockAlert })} aria-label="부족 알림 기준" /></td>
        <td className="num">{option.orderedQty}</td>
        <td><button type="button" className="gbx-icon-btn" disabled={ordered(option) || product.options.length === 1} title={ordered(option) ? "주문이 있는 옵션은 삭제할 수 없어요" : "옵션 삭제"} aria-label="옵션 삭제" onClick={() => onChange({ options: product.options.filter((item) => item.id !== option.id) })}><Trash2 /></button></td>
      </tr>)}</tbody></table>
    <button type="button" className="gbx-link" onClick={() => onChange({ options: [...product.options, { id: newId(), name: "", ...defaults, orderedQty: 0 }] })}>+ 옵션 추가</button>
  </div>;
}

// ── 실측 사이즈표 ────────────────────────────────────────

const MEASURE_PRESETS = { 하의: ["총장", "허리", "밑위", "허벅지", "힙", "밑단"], 상의: ["총장", "어깨", "가슴", "소매", "암홀"] } as const;

export function SizeChartEditor({ product, onChange }: { product: GbProduct; onChange: (change: Partial<GbProduct>) => void }) {
  const [newMeasure, setNewMeasure] = useState("");
  const chart = product.sizeChart;
  const axes = product.axes;
  const sizeAxisGuess = axes.find((axis) => axis.name.includes("사이즈")) ?? axes[axes.length - 1];

  if (!axes.length) return <p className="gbx-help">옵션 분류에 사이즈를 먼저 추가하면 실측 사이즈표를 만들 수 있어요.</p>;
  if (!chart) return <div className="gbs-chart-start">
    <p className="gbx-help">상세페이지에 ‘사이즈’ 탭이 생기고, 고객이 옵션을 고를 때 ‘실측 사이즈 자세히’ 링크가 보여요.</p>
    <div className="gbs-chart-starts">
      {(Object.keys(MEASURE_PRESETS) as (keyof typeof MEASURE_PRESETS)[]).map((kind) => <button key={kind} type="button" className="gbx-btn" onClick={() => onChange({ sizeChart: { unit: "cm", note: "단면 치수입니다. 측정 방법에 따라 1~2cm 오차가 있을 수 있어요.", sizeAxis: sizeAxisGuess.name, groupAxes: [], measurements: [...MEASURE_PRESETS[kind]], diagram: kind === "하의" ? "pants" : null, rows: [] } })}><Plus />{kind} 사이즈표 만들기</button>)}
    </div>
  </div>;

  const set = (change: Partial<SizeChart>) => onChange({ sizeChart: { ...chart, ...change } });
  const sizeAxis = axes.find((axis) => axis.name === chart.sizeAxis) ?? sizeAxisGuess;
  const groupAxes = axes.filter((axis) => chart.groupAxes.includes(axis.name) && axis.name !== sizeAxis.name);
  // 실제로 파는 조합에 있는 그룹·사이즈만 표에 만든다(예: 와이드 슈퍼롱은 L만).
  const rowKeys = cartesian([...groupAxes, sizeAxis]).filter((key) => product.options.some((option) => Object.entries(key).every(([name, value]) => option.attrs?.[name] === value)));
  const rowFor = (key: Combo) => chart.rows.find((row) => Object.entries(key).every(([name, value]) => row.key[name] === value) && Object.keys(row.key).length === Object.keys(key).length);
  function setValue(key: Combo, index: number, value: string) {
    const existing = rowFor(key);
    const values = chart!.measurements.map((_, i) => i === index ? value : existing?.values[i] ?? "");
    set({ rows: existing ? chart!.rows.map((row) => row === existing ? { ...row, values } : row) : [...chart!.rows, { key, values }] });
  }
  function toggleGroup(name: string, on: boolean) {
    // 그룹이 바뀌면 행 열쇠가 달라지므로 기존 값은 비운다(되돌리기로 복구 가능).
    set({ groupAxes: on ? axes.map((axis) => axis.name).filter((axisName) => axisName === name || chart!.groupAxes.includes(axisName)) : chart!.groupAxes.filter((item) => item !== name), rows: [] });
  }
  function addMeasure(raw: string) {
    const name = raw.trim();
    if (!name || chart!.measurements.includes(name)) return;
    set({ measurements: [...chart!.measurements, name], rows: chart!.rows.map((row) => ({ ...row, values: [...row.values, ""] })) });
    setNewMeasure("");
  }
  const removeMeasure = (index: number) => set({ measurements: chart.measurements.filter((_, i) => i !== index), rows: chart.rows.map((row) => ({ ...row, values: row.values.filter((_, i) => i !== index) })) });

  return <div className="gbs-chart">
    <div className="gbs-chart-setup">
      <label>사이즈 분류<select value={sizeAxis.name} onChange={(e) => set({ sizeAxis: e.target.value, groupAxes: chart.groupAxes.filter((name) => name !== e.target.value), rows: [] })}>{axes.map((axis) => <option key={axis.name}>{axis.name}</option>)}</select></label>
      <div className="gbs-chart-groups"><span>치수가 달라지는 분류</span>{axes.filter((axis) => axis.name !== sizeAxis.name).map((axis) => <label key={axis.name} className="gbx-check-label"><input type="checkbox" checked={chart.groupAxes.includes(axis.name)} onChange={(e) => toggleGroup(axis.name, e.target.checked)} />{axis.name}</label>)}</div>
      <label>도식<select value={chart.diagram ?? ""} onChange={(e) => set({ diagram: e.target.value === "pants" ? "pants" : null })}><option value="pants">바지 도식</option><option value="">도식 없이 표만</option></select></label>
    </div>
    <div className="gbs-values gbs-measures">
      <span className="gbs-measures-label">측정 항목</span>
      {chart.measurements.map((name, index) => <span key={name} className="gbs-value"><b>{name}</b><button type="button" aria-label={`${name} 빼기`} onClick={() => removeMeasure(index)}><X /></button></span>)}
      <span className="gbs-value-add"><input value={newMeasure} onChange={(e) => setNewMeasure(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMeasure(newMeasure); } }} placeholder="항목 추가" aria-label="측정 항목 추가" /><button type="button" onClick={() => addMeasure(newMeasure)} aria-label="추가"><Plus /></button></span>
    </div>
    <div className="gbs-table-wrap"><table className="gbs-table gbs-chart-table">
      <thead><tr>{[...groupAxes, sizeAxis].map((axis) => <th key={axis.name}>{axis.name}</th>)}{chart.measurements.map((name) => <th key={name}>{name}</th>)}</tr></thead>
      <tbody>{rowKeys.map((key) => { const row = rowFor(key); return <tr key={Object.values(key).join(" ")}>
        {[...groupAxes, sizeAxis].map((axis) => <td key={axis.name}>{key[axis.name]}</td>)}
        {chart.measurements.map((name, index) => <td key={name}><input value={row?.values[index] ?? ""} onChange={(e) => setValue(key, index, e.target.value)} inputMode="decimal" aria-label={`${Object.values(key).join(" ")} ${name}`} placeholder="–" /></td>)}
      </tr>; })}</tbody>
    </table></div>
    <label className="gbs-field wide"><span className="gbs-label">사이즈표 아래 안내<small>한 줄에 하나씩</small></span><textarea rows={3} value={chart.note} onChange={(e) => set({ note: e.target.value })} /></label>
    <button type="button" className="gbx-link red" onClick={() => onChange({ sizeChart: null })}>사이즈표 삭제</button>
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import type { GbProduct, SizeChart } from "./types";
import { axesFor, sizeRows, type Selection } from "./variants";

/** 바지 평면 도식 + 치수 표시. 측정 항목: 총장·허리·밑위·허벅지·힙·밑단 */
export function PantsDiagram({ values, wide }: { values: Record<string, string>; wide: boolean }) {
  const v = (name: string) => values[name] ?? "–";
  const hemL: [number, number] = wide ? [62, 140] : [92, 136];
  const hemR: [number, number] = wide ? [180, 258] : [184, 228];
  const outer = (y: number) => 80 + ((hemL[0] - 80) * (y - 90)) / 280;
  const inner = (y: number) => 160 + ((hemL[1] - 160) * (y - 140)) / 230;
  return <svg className="gb-diagram" viewBox="0 0 340 410" role="img" aria-label={`실측 도식: 총장 ${v("총장")}, 허리 ${v("허리")}, 밑위 ${v("밑위")}, 허벅지 ${v("허벅지")}, 힙 ${v("힙")}, 밑단 ${v("밑단")}`}>
    <path d={`M90 34 H230 L240 90 L${hemR[1]} 370 H${hemR[0]} L160 140 L${hemL[1]} 370 H${hemL[0]} L80 90 Z`} className="shape" />
    <path d="M90 48 H230" className="seam" />
    <path d="M160 48 V140" className="seam" />
    {/* 허리 */}
    <path d="M90 22 H230 M90 17 V27 M230 17 V27" className="measure" />
    <text x="160" y="13" textAnchor="middle">허리 <tspan className="value">{v("허리")}</tspan></text>
    {/* 힙 */}
    <path d="M80 92 H240" className="measure dashed" />
    <text x="198" y="86" textAnchor="middle">힙 <tspan className="value">{v("힙")}</tspan></text>
    {/* 밑위 */}
    <path d="M150 34 V140 M145 140 H155" className="measure" />
    <text x="144" y="122" textAnchor="end">밑위 <tspan className="value">{v("밑위")}</tspan></text>
    {/* 허벅지 */}
    <path d={`M${outer(165)} 165 H${inner(165)}`} className="measure dashed" />
    <text x={(outer(165) + inner(165)) / 2} y="182" textAnchor="middle">허벅지 <tspan className="value">{v("허벅지")}</tspan></text>
    {/* 총장 */}
    <path d="M286 34 V370 M281 34 H291 M281 370 H291" className="measure" />
    <text x="294" y="206">총장</text>
    <text x="294" y="222" className="value">{v("총장")}</text>
    {/* 밑단 */}
    <path d={`M${hemL[0]} 384 H${hemL[1]} M${hemL[0]} 379 V389 M${hemL[1]} 379 V389`} className="measure" />
    <text x={(hemL[0] + hemL[1]) / 2} y="403" textAnchor="middle">밑단 <tspan className="value">{v("밑단")}</tspan></text>
  </svg>;
}

/** 옵션 영역의 사이즈 칩 아래에 붙는 간단 실측(고른 종류·기장의 행만). */
export function SizePeek({ chart, selection }: { chart: SizeChart; selection: Selection }) {
  const rows = sizeRows(chart, selection);
  if (!rows.length) return <p className="gb-pdp-peek-empty">{chart.groupAxes.join("·")}을 고르면 실측이 보여요</p>;
  return <table className="gb-pdp-peek">
    <thead><tr><th>{chart.sizeAxis}</th>{chart.measurements.map((name) => <th key={name}>{name}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key[chart.sizeAxis]} className={selection[chart.sizeAxis] === row.key[chart.sizeAxis] ? "active" : ""}><th>{row.key[chart.sizeAxis]}</th>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody>
  </table>;
}

/** 앞 축을 바꿔 뒤 축 값이 없는 조합이 되면, 뒤 축을 가능한 첫 값으로 맞춘다(예: 와이드 → 슬림). */
function fitGroup(chart: SizeChart, group: Record<string, string>) {
  const next = { ...group };
  chart.groupAxes.forEach((axis, index) => {
    const prefix = chart.groupAxes.slice(0, index);
    const pool = chart.rows.filter((row) => prefix.every((key) => row.key[key] === next[key]));
    if (!pool.some((row) => row.key[axis] === next[axis])) next[axis] = pool[0]?.key[axis] ?? next[axis];
  });
  return next;
}

/** 사이즈 탭: 종류·기장을 고르고, 사이즈 탭으로 열을 강조한다(참고 이미지의 실측 사이즈 화면). */
export function SizeChartView({ product, chart, selection }: { product: GbProduct; chart: SizeChart; selection: Selection }) {
  const axes = axesFor(product).filter((axis) => chart.groupAxes.includes(axis.name));
  const firstGroup = () => Object.fromEntries(chart.groupAxes.map((axis) => [axis, selection[axis] ?? chart.rows[0]?.key[axis] ?? ""]));
  const [group, setGroup] = useState<Record<string, string>>(firstGroup);
  // 옵션에서 고른 종류·기장이 바뀌면 사이즈 탭도 따라간다.
  useEffect(() => { if (chart.groupAxes.every((axis) => selection[axis])) setGroup(Object.fromEntries(chart.groupAxes.map((axis) => [axis, selection[axis]]))); }, [chart.groupAxes, selection]);
  const rows = sizeRows(chart, group);
  const [size, setSize] = useState(selection[chart.sizeAxis] ?? "");
  const activeSize = rows.some((row) => row.key[chart.sizeAxis] === size) ? size : rows[0]?.key[chart.sizeAxis] ?? "";
  const activeRow = rows.find((row) => row.key[chart.sizeAxis] === activeSize);
  const values = Object.fromEntries(chart.measurements.map((name, index) => [name, activeRow?.values[index] ?? "–"]));
  const groupExists = (axis: string, value: string) => chart.rows.some((row) => row.key[axis] === value && chart.groupAxes.slice(0, chart.groupAxes.indexOf(axis)).every((other) => row.key[other] === group[other]));

  return <section className="gb-sizechart">
    <h2>실측 사이즈</h2>
    <div className="gb-sizechart-groups">{axes.map((axis) => <div key={axis.name} role="group" aria-label={axis.name}>
      <span>{axis.name}</span>
      {axis.values.map((value) => <button key={value} type="button" disabled={!groupExists(axis.name, value)} className={group[axis.name] === value ? "active" : ""} onClick={() => setGroup((current) => fitGroup(chart, { ...current, [axis.name]: value }))}>{value}</button>)}
    </div>)}</div>
    <div className="gb-sizechart-sizes" role="tablist" aria-label={chart.sizeAxis}>{rows.map((row) => { const key = row.key[chart.sizeAxis]; return <button key={key} type="button" role="tab" aria-selected={key === activeSize} className={key === activeSize ? "active" : ""} onClick={() => setSize(key)}>{key}</button>; })}</div>
    <div className="gb-sizechart-body">
      {chart.diagram === "pants" ? <figure className="gb-sizechart-figure"><PantsDiagram values={values} wide={group["종류"] === "와이드"} /></figure> : null}
      <div className="gb-sizechart-table">
        <p className="gb-sizechart-unit">(단위: {chart.unit})</p>
        <table>
          <thead><tr><th>{chart.sizeAxis}</th>{rows.map((row) => { const key = row.key[chart.sizeAxis]; return <th key={key} className={key === activeSize ? "active" : ""}><button type="button" onClick={() => setSize(key)}>{key}</button></th>; })}</tr></thead>
          <tbody>{chart.measurements.map((name, index) => <tr key={name}><th>{name}</th>{rows.map((row, column) => <td key={column} className={row.key[chart.sizeAxis] === activeSize ? "active" : ""}>{row.values[index]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
    {chart.note ? <ul className="gb-sizechart-note">{chart.note.split("\n").filter(Boolean).map((line) => <li key={line}>{line}</li>)}</ul> : null}
  </section>;
}

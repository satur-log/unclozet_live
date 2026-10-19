import { remainingStock } from "./pricing";
import type { GbOption, GbProduct, SizeChart, VariantAxis } from "./types";

// 옵션 축(종류 → 기장 → 사이즈 → 컬러) 선택 규칙.
// 존재하는 조합만 고를 수 있고, 앞에서 고른 값 때문에 선택지가 하나만 남으면 자동으로 고른다.
// 단 마지막 축(컬러)은 고르면 바로 담기므로 자동으로 고르지 않는다.
// 축이 없는 단순 상품은 "옵션" 축 하나로 다룬다.

export type Selection = Record<string, string>;
const SIMPLE_AXIS = "옵션";

export function axesFor(product: GbProduct): VariantAxis[] {
  return product.axes.length ? product.axes : [{ name: SIMPLE_AXIS, values: product.options.map((option) => option.name) }];
}

export function attrsOf(product: GbProduct, option: GbOption): Selection {
  return product.axes.length ? option.attrs ?? {} : { [SIMPLE_AXIS]: option.name };
}

const matches = (attrs: Selection, selection: Selection) => Object.entries(selection).every(([axis, value]) => attrs[axis] === value);

/** 앞 축들의 선택(이후 축은 무시)과 맞는 옵션들. */
function candidates(product: GbProduct, axisIndex: number, selection: Selection) {
  const axes = axesFor(product);
  const prior = Object.fromEntries(axes.slice(0, axisIndex).map((axis) => [axis.name, selection[axis.name]]).filter(([, value]) => value));
  return product.options.filter((option) => matches(attrsOf(product, option), prior));
}

export type ValueState = { value: string; exists: boolean; soldOut: boolean };

/** 축의 각 값이 지금 고를 수 있는지. 첫 축(종류)을 고르기 전에는 나머지 축이 잠긴다(locked). */
export function axisState(product: GbProduct, axisIndex: number, selection: Selection): { locked: boolean; values: ValueState[] } {
  const axes = axesFor(product);
  const axis = axes[axisIndex];
  const locked = axisIndex > 0 && !selection[axes[0].name];
  const pool = candidates(product, axisIndex, selection);
  return {
    locked,
    values: axis.values.map((value) => {
      const options = pool.filter((option) => attrsOf(product, option)[axis.name] === value);
      return { value, exists: options.length > 0, soldOut: options.length > 0 && options.every((option) => remainingStock(option) <= 0) };
    }),
  };
}

/**
 * 값을 고른 뒤 정리: 뒤 축의 값이 더는 존재하지 않으면 지우고, 선택지가 하나뿐인 축은 자동으로 채운다(마지막 축은 제외).
 * hints에는 "와이드 슈퍼롱은 L 사이즈만 있어요" 같은 안내를 축 이름별로 담는다.
 */
export function normalizeSelection(product: GbProduct, selection: Selection): { selection: Selection; hints: Record<string, string> } {
  const axes = axesFor(product);
  const next: Selection = {};
  const hints: Record<string, string> = {};
  for (let index = 0; index < axes.length; index += 1) {
    const axis = axes[index];
    if (index > 0 && !next[axes[0].name]) break;
    const available = axisState(product, index, next).values.filter((state) => state.exists).map((state) => state.value);
    // 마지막 축(컬러)은 고르는 순간 담기므로 자동으로 채우지 않는다. 고객이 직접 눌러야 무엇을 담았는지 안다.
    const last = axes.length > 1 && index === axes.length - 1;
    if (last) {
      if (selection[axis.name] && available.includes(selection[axis.name])) next[axis.name] = selection[axis.name];
    } else if (available.length === 1 && axis.values.length > 1) {
      next[axis.name] = available[0];
      const reason = forcingPrefix(product, index, next);
      if (reason) hints[axis.name] = `${reason}${josa(reason)} ${available[0]}${axis.name === "사이즈" || axis.name === "컬러" ? ` ${axis.name}` : ""}만 있어요`;
    } else if (selection[axis.name] && available.includes(selection[axis.name])) {
      next[axis.name] = selection[axis.name];
    } else if (available.length === 1) {
      next[axis.name] = available[0];
    }
  }
  return { selection: next, hints };
}

/** 선택지를 하나로 줄인 가장 짧은 앞 선택(예: 와이드+슈퍼롱 → "와이드 슈퍼롱", 슬림 → "슬림"). */
function forcingPrefix(product: GbProduct, axisIndex: number, selection: Selection) {
  const axes = axesFor(product);
  const axis = axes[axisIndex];
  const chosen = axes.slice(0, axisIndex).map((prior) => prior.name).filter((name) => selection[name]);
  for (let size = 1; size <= chosen.length; size += 1) {
    for (const subset of combinations(chosen, size)) {
      const partial = Object.fromEntries(subset.map((name) => [name, selection[name]]));
      const values = new Set(product.options.filter((option) => matches(attrsOf(product, option), partial)).map((option) => attrsOf(product, option)[axis.name]));
      if (values.size === 1) return subset.map((name) => selection[name]).join(" ");
    }
  }
  return "";
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

/** 받침 유무로 은/는 */
export function josa(word: string) {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return /[A-Za-z0-9]$/.test(last) ? (/[LMNR136780]$/i.test(last) ? "은" : "는") : "는";
  return code % 28 ? "은" : "는";
}

/** 모든 축을 골랐으면 해당 옵션 */
export function resolveOption(product: GbProduct, selection: Selection) {
  const axes = axesFor(product);
  if (axes.some((axis) => !selection[axis.name])) return null;
  return product.options.find((option) => matches(attrsOf(product, option), selection)) ?? null;
}

/** 실측표에서 고른 그룹(예: 슬림·숏)에 맞는 행들. 그룹 축을 다 고르지 않았으면 빈 배열. */
export function sizeRows(chart: SizeChart, selection: Selection) {
  if (chart.groupAxes.some((axis) => !selection[axis])) return [];
  return chart.rows.filter((row) => chart.groupAxes.every((axis) => row.key[axis] === selection[axis]));
}

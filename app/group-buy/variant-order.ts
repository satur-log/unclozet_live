import type { GbOption, VariantAxis } from "./types";

const preferredValues: Record<string, string[]> = {
  "종류": ["와이드", "슬림", "기모 와이드", "기모 일반"],
  "기장": ["숏", "롱", "슈퍼롱"],
  "사이즈": ["F", "L"],
  "컬러": ["블랙", "그레이", "챠콜"],
  "색상": ["블랙", "그레이", "챠콜"],
};

/** Known product values use a consistent display order; other values keep their configured order. */
export function orderedAxisValues(axis: VariantAxis) {
  const preferred = preferredValues[axis.name] ?? [];
  return [...axis.values].sort((a, b) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai >= 0 || bi >= 0) {
      if (ai < 0) return 1;
      if (bi < 0) return -1;
      return ai - bi;
    }
    return axis.values.indexOf(a) - axis.values.indexOf(b);
  });
}

export function compareOptionAttrs(axes: VariantAxis[], a: GbOption["attrs"], b: GbOption["attrs"]) {
  for (const axis of axes) {
    const values = orderedAxisValues(axis);
    const ai = values.indexOf(a?.[axis.name] ?? "");
    const bi = values.indexOf(b?.[axis.name] ?? "");
    const order = (ai < 0 ? values.length : ai) - (bi < 0 ? values.length : bi);
    if (order) return order;
  }
  return 0;
}

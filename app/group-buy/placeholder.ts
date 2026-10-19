// 시드·테스트용 상품 이미지. 외부 이미지 없이 SVG data URI로 만든다.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function placeholderImage(label: string, hue: number, caption = "", ratio: "square" | "wide" | "tall" = "square") {
  const [w, h] = ratio === "wide" ? [1200, 720] : ratio === "tall" ? [900, 1200] : [900, 900];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 90%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 40% 78%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.22}" fill="hsl(${hue} 40% 96%)" opacity=".55"/>
<text x="50%" y="${caption ? "47%" : "52%"}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 11)}" font-weight="700" fill="hsl(${hue} 35% 30%)">${escape(label)}</text>
${caption ? `<text x="50%" y="58%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 24)}" fill="hsl(${hue} 25% 38%)">${escape(caption)}</text>` : ""}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 바지 실루엣 자리표시 이미지(실제 상품 사진 대신). */
export function pantsImage(color: "black" | "melange", fit: "slim" | "wide", caption = "") {
  const fill = color === "black" ? "#2a2a2c" : "#9a9894";
  const shade = color === "black" ? "#1c1c1e" : "#878581";
  const legSpread = fit === "wide" ? 70 : 30;
  const hem = fit === "wide" ? 150 : 95;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
<rect width="900" height="900" fill="#e9e9e7"/>
<path d="M300 110 H600 L${615 + legSpread} 800 H${615 + legSpread - hem} L455 330 L${285 - legSpread + hem} 800 H${285 - legSpread} Z" fill="${fill}"/>
<rect x="300" y="110" width="300" height="34" fill="${shade}"/>
<path d="M455 144 V330" stroke="${shade}" stroke-width="4"/>
${caption ? `<text x="450" y="860" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#6b6b6b">${escape(caption)}</text>` : ""}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

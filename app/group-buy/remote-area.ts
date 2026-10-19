// 제주·도서산간 판별. 택배사 추가 운임은 5자리 우편번호(국가기초구역번호) 범위로 정해진다.
// 제주는 63000~63644 전체. 도서산간은 쇼핑몰들이 흔히 쓰는 목록을 넣어 두었고,
// 운영 전에 CJ대한통운 계약 담당자에게 받은 최신 목록과 대조해 고친다.

type Range = readonly [number, number];

const JEJU: Range = [63000, 63644];

const ISLANDS: Range[] = [
  [22386, 22388], // 인천 중구 섬
  [23004, 23010], [23100, 23116], [23124, 23136], // 인천 옹진
  [32133, 32133], // 충남 태안 섬
  [33411, 33411], // 충남 보령 섬
  [40200, 40240], // 경북 울릉
  [46768, 46771], // 부산 강서 섬
  [52570, 52571], // 경남 사천 섬
  [53031, 53033], [53089, 53104], // 경남 통영 섬
  [54000, 54000], // 전북 군산 섬
  [56347, 56349], // 전북 부안 섬
  [57068, 57069], // 전남 영광 섬
  [58760, 58762], [58800, 58810], [58816, 58818], [58826, 58826], [58828, 58866], [58953, 58958], // 전남 목포·신안·진도
  [59102, 59103], [59106, 59106], [59127, 59127], [59129, 59129], [59137, 59166], // 전남 완도
  [59650, 59650], [59766, 59766], [59781, 59790], // 전남 여수·고흥 섬
];

const inRange = (code: number, [from, to]: Range) => code >= from && code <= to;

export type RemoteArea = "jeju" | "island" | null;

/** 우편번호로 판별한다. 우편번호가 없으면(주소 검색 실패 등) 주소가 "제주"로 시작할 때만 제주로 본다. */
export function remoteAreaOf(postcode: string, address = ""): RemoteArea {
  const digits = postcode.replace(/\D/g, "");
  if (digits.length !== 5) return /^\s*제주/.test(address) ? "jeju" : null;
  const code = Number(digits);
  if (inRange(code, JEJU)) return "jeju";
  return ISLANDS.some((range) => inRange(code, range)) ? "island" : null;
}

export const remoteAreaLabel = (area: RemoteArea) => area === "jeju" ? "제주" : area === "island" ? "도서산간" : "";

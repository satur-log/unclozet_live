import { canonicalInstagramId, normalizePhoneNumber } from "./shipping-parser";
import type { CustomerImportRecord, Delivery } from "./types";

const requiredHeaders = {
  name: ["받는분성명", "받는분 성명", "받는분"],
  address: ["받는분주소", "받는분 주소"],
  phone: ["전화번호", "기타연락처", "기타 연락처", "받는분전화번호", "받는분 전화번호"],
  instagramId: ["품목명", "상품명", "인스타그램ID", "인스타그램아이디"],
} as const;

const text = (value: unknown) => value == null ? "" : String(value).trim();
const headerKey = (value: unknown) => text(value).replace(/\s+/g, "").toLowerCase();

function findColumn(header: unknown[], candidates: readonly string[]) {
  const keys = candidates.map(headerKey);
  return header.findIndex((value) => keys.includes(headerKey(value)));
}

function sameDelivery(a: Delivery, b: Delivery) {
  return a.name === b.name && a.address === b.address && a.phone === b.phone;
}

export function parseCustomerWorkbookRows(rows: readonly (readonly unknown[])[]): CustomerImportRecord[] {
  const headerIndex = rows.findIndex((row) =>
    findColumn([...row], requiredHeaders.name) >= 0
    && findColumn([...row], requiredHeaders.address) >= 0
    && findColumn([...row], requiredHeaders.instagramId) >= 0
    && findColumn([...row], requiredHeaders.phone) >= 0);
  if (headerIndex < 0) throw new Error("엑셀에서 고객정보 열을 찾지 못했습니다. 기존 출력 양식인지 확인하세요.");

  const header = [...rows[headerIndex]];
  const columns = {
    name: findColumn(header, requiredHeaders.name),
    address: findColumn(header, requiredHeaders.address),
    phone: findColumn(header, ["전화번호", "받는분전화번호", "받는분 전화번호"]),
    otherPhone: findColumn(header, ["기타연락처", "기타 연락처"]),
    instagramId: findColumn(header, requiredHeaders.instagramId),
  };
  const records = new Map<string, CustomerImportRecord>();

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.some((value) => text(value))) continue;
    const instagramId = canonicalInstagramId(text(row[columns.instagramId]));
    const rawPhone = text(row[columns.phone]) || text(row[columns.otherPhone]);
    const delivery = {
      name: text(row[columns.name]).replace(/\s+/g, " "),
      address: text(row[columns.address]).replace(/\s+/g, " "),
      phone: normalizePhoneNumber(rawPhone.length === 10 && rawPhone.startsWith("10") ? `0${rawPhone}` : rawPhone),
    };
    const rowNumber = index + 1;
    const problems = [
      !instagramId ? "인스타그램 ID" : "",
      !delivery.name ? "받는분 성명" : "",
      !delivery.address ? "주소" : "",
      !/^010-\d{4}-\d{4}$/.test(delivery.phone) ? "전화번호" : "",
    ].filter(Boolean);
    if (problems.length) throw new Error(`${rowNumber}행의 ${problems.join(", ")} 정보를 확인하세요.`);
    const previous = records.get(instagramId);
    if (previous && !sameDelivery(previous.delivery, delivery)) {
      throw new Error(`${previous.row}행과 ${rowNumber}행에 같은 인스타그램 ID의 정보가 다릅니다.`);
    }
    records.set(instagramId, { instagramId, delivery, row: rowNumber });
  }

  if (!records.size) throw new Error("가져올 고객정보가 없습니다.");
  return [...records.values()];
}

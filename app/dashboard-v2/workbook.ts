// Existing ZIP/XML workbook writer, isolated from the V1 UI.
function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stringToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pushUInt16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUInt32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(entries: Array<{ name: string; content: string }>) {
  const output: number[] = [];
  const centralDirectory: number[] = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  entries.forEach((entry) => {
    const nameBytes = stringToBytes(entry.name);
    const contentBytes = stringToBytes(entry.content);
    const checksum = crc32(contentBytes);
    const offset = output.length;

    pushUInt32(output, 0x04034b50);
    pushUInt16(output, 20);
    pushUInt16(output, 0);
    pushUInt16(output, 0);
    pushUInt16(output, dosTime);
    pushUInt16(output, dosDate);
    pushUInt32(output, checksum);
    pushUInt32(output, contentBytes.length);
    pushUInt32(output, contentBytes.length);
    pushUInt16(output, nameBytes.length);
    pushUInt16(output, 0);
    output.push(...nameBytes, ...contentBytes);

    pushUInt32(centralDirectory, 0x02014b50);
    pushUInt16(centralDirectory, 20);
    pushUInt16(centralDirectory, 20);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, dosTime);
    pushUInt16(centralDirectory, dosDate);
    pushUInt32(centralDirectory, checksum);
    pushUInt32(centralDirectory, contentBytes.length);
    pushUInt32(centralDirectory, contentBytes.length);
    pushUInt16(centralDirectory, nameBytes.length);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt16(centralDirectory, 0);
    pushUInt32(centralDirectory, 0);
    pushUInt32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);
  });

  const centralDirectoryOffset = output.length;
  output.push(...centralDirectory);
  pushUInt32(output, 0x06054b50);
  pushUInt16(output, 0);
  pushUInt16(output, 0);
  pushUInt16(output, entries.length);
  pushUInt16(output, entries.length);
  pushUInt32(output, centralDirectory.length);
  pushUInt32(output, centralDirectoryOffset);
  pushUInt16(output, 0);

  return new Uint8Array(output);
}

function columnName(index: number) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function worksheetRow(rowIndex: number, values: string[]) {
  const cells = values
    .map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .join("");

  return `<row r="${rowIndex}">${cells}</row>`;
}

export function createShippingWorkbook(header: string[], rows: string[][]) {
  const sheetRows = [
    '<row r="1"></row>',
    worksheetRow(2, header),
    ...rows.map((row, index) => worksheetRow(index + 3, row)),
  ].join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G${rows.length + 2}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${sheetRows}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>
</worksheet>`;

  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="배송주문" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]);
}


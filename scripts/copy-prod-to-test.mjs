#!/usr/bin/env node
// 운영 Supabase → 테스트 Supabase 데이터 복사.
// - 운영에는 GET(읽기)만 보낸다. 이 스크립트에는 운영에 쓰는 코드가 없다.
// - 테스트에는 upsert만 한다(삭제 없음). 여러 번 실행해도 같은 결과.
// - 키는 실행 중에 화면에 보이지 않게 입력받고, 파일·셸 기록에 남기지 않는다.
//
// 실행: node scripts/copy-prod-to-test.mjs

import readline from "node:readline";

const TABLES = [
  { name: "dashboard_v2_workspaces", key: "id" },
  { name: "live_memos", key: "id" },
  { name: "shipping_rounds", key: "id" },
  { name: "gb_group_buys", key: "id" },
  { name: "gb_orders", key: "id" },
  { name: "gb_stock_logs", key: "id" },
  { name: "gb_lookup_locks", key: "phone" },
  { name: "gb_counters", key: "name" },
];
const PAGE = 1000;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

function normalizeUrl(value) {
  const url = value.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error(`Supabase URL 형식이 아닙니다: ${url}`);
  return url;
}

function authHeaders(key) {
  return key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

async function readAll(url, key, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const response = await fetch(`${url}/rest/v1/${table.name}?select=*&order=${table.key}.asc`, {
      method: "GET",
      headers: { ...authHeaders(key), Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items" },
    });
    if (!response.ok) throw new Error(`[운영 읽기 실패] ${table.name}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function countRows(url, key, table) {
  const response = await fetch(`${url}/rest/v1/${table.name}?select=${table.key}`, {
    method: "GET",
    headers: { ...authHeaders(key), Prefer: "count=exact", Range: "0-0" },
  });
  if (!response.ok) throw new Error(`[테스트 확인 실패] ${table.name}: ${response.status} ${await response.text()} — test-project-setup.sql을 먼저 실행했는지 확인하세요.`);
  const range = response.headers.get("content-range") ?? "*/0";
  return Number(range.split("/")[1] ?? 0);
}

async function upsertAll(url, key, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const response = await fetch(`${url}/rest/v1/${table.name}?on_conflict=${table.key}`, {
      method: "POST",
      headers: { ...authHeaders(key), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!response.ok) throw new Error(`[테스트 쓰기 실패] ${table.name}: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  console.log("운영 → 테스트 Supabase 복사 (운영은 읽기만 합니다)\n");
  const prodUrl = normalizeUrl(await ask("운영 Supabase URL: "));
  const prodKey = await ask("운영 service_role(secret) 키 (입력이 보이지 않습니다): ", { hidden: true });
  const testUrl = normalizeUrl(await ask("테스트 Supabase URL: "));
  const testKey = await ask("테스트 service_role(secret) 키 (입력이 보이지 않습니다): ", { hidden: true });

  if (prodUrl === testUrl) throw new Error("운영과 테스트 URL이 같습니다. 중단합니다.");
  if (prodKey === testKey) throw new Error("운영과 테스트 키가 같습니다. 중단합니다.");

  console.log("\n운영 데이터 읽는 중…");
  const data = [];
  for (const table of TABLES) {
    const rows = await readAll(prodUrl, prodKey, table);
    const existing = await countRows(testUrl, testKey, table);
    data.push({ table, rows, existing });
    console.log(`  ${table.name.padEnd(26)} 운영 ${String(rows.length).padStart(5)}건 / 테스트 현재 ${existing}건`);
  }
  const workspace = data[0].rows.find((row) => row.id === "main");
  if (workspace) {
    const state = workspace.state ?? {};
    const kb = Math.ceil(Buffer.byteLength(JSON.stringify(state)) / 1024);
    console.log(`\n  V2 작업공간: 방송 ${state.broadcasts?.length ?? 0}건, 고객 ${state.customers?.length ?? 0}건, 크기 약 ${kb}KB${kb > 3500 ? "  ⚠ 4MB에 가까움 — 알려주세요" : ""}`);
  } else {
    console.log("\n  ⚠ 운영에 V2 작업공간(main) 행이 없습니다.");
  }

  console.log(`\n쓰기 대상: ${testUrl}  (테스트 프로젝트)`);
  const answer = await ask("위 테스트 프로젝트에 복사할까요? 맞으면 copy 를 입력: ");
  if (answer !== "copy") { console.log("취소했습니다. 아무것도 쓰지 않았습니다."); return; }

  for (const { table, rows } of data) {
    if (rows.length) await upsertAll(testUrl, testKey, table, rows);
    console.log(`  ✓ ${table.name}`);
  }

  console.log("\n복사 후 테스트 프로젝트 확인:");
  for (const { table, rows } of data) {
    const after = await countRows(testUrl, testKey, table);
    console.log(`  ${table.name.padEnd(26)} ${after}건 ${after >= rows.length ? "✓" : "⚠ 운영보다 적음"}`);
  }
  console.log("\n완료. 상품 이미지는 운영 이미지 주소를 그대로 가리킵니다(보기만 하므로 운영에 영향 없음).");
}

main().catch((error) => { console.error(`\n오류: ${error.message}`); process.exit(1); });

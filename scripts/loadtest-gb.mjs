#!/usr/bin/env node
// 공구 고객 화면 부하 테스트 (Preview + 테스트 Supabase 전용).
// - 운영 주소(unclozet.vercel.app, gb.uncloset.co.kr 등)는 거부한다. *.vercel.app의 Preview 주소만 받는다.
// - 테스트 주문은 주문자명이 "부하테스트-<runId>-"로 시작한다. 정리 SQL로 한 번에 지울 수 있다.
// - 방화벽에 공격으로 보이지 않도록: 실제 브라우저 헤더, 사용자마다 도착 시간·생각 시간 분산, 429·403이 나오면 즉시 멈춤.
//
// 실행 예:
//   node scripts/loadtest-gb.mjs https://<preview>.vercel.app browse 500 60
//   node scripts/loadtest-gb.mjs https://<preview>.vercel.app order 50,150,300 3
//   node scripts/loadtest-gb.mjs https://<preview>.vercel.app smoke 5

import { writeFileSync, mkdirSync } from "node:fs";

const [, , baseArg, mode = "smoke", countArg = "5", spreadArg = "3"] = process.argv;
if (!baseArg) { console.error("사용법: node scripts/loadtest-gb.mjs <preview-url> <smoke|browse|order> <count|waves> <spread-seconds>"); process.exit(1); }
const base = new URL(baseArg);
const PROD_HOSTS = ["unclozet.vercel.app", "gb.uncloset.co.kr", "uncloset.co.kr", "www.uncloset.co.kr"];
if (PROD_HOSTS.includes(base.hostname) || !base.hostname.endsWith(".vercel.app") || !/-[a-z0-9]{9}-/.test(base.hostname)) {
  console.error(`거부: ${base.hostname} 는 배포별 Preview 주소가 아닙니다. 운영에는 실행하지 않습니다.`);
  process.exit(1);
}
const origin = base.origin;
const SLUG = "pants";
const runId = Date.now().toString(36).slice(-5);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);

let blocked = null;
async function timed(label, url, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: `${origin}/pants`, ...init.headers },
    });
    const text = await response.text();
    const ms = performance.now() - started;
    if ((response.status === 429 || response.status === 403) && !blocked) blocked = `${label} ${response.status}: ${text.slice(0, 160)}`;
    return { label, status: response.status, ms, text };
  } catch (error) {
    return { label, status: 0, ms: performance.now() - started, text: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

function summarize(results) {
  const byLabel = {};
  for (const r of results) (byLabel[r.label] ??= []).push(r);
  const out = {};
  for (const [label, rows] of Object.entries(byLabel)) {
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p) => Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]);
    const statuses = {};
    for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    out[label] = { count: rows.length, statuses, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: Math.round(ms.at(-1)) };
  }
  return out;
}

async function loadOptions() {
  const r = await timed("setup", `${origin}/api/gb/public/${SLUG}`, { headers: { Accept: "application/json" } });
  if (r.status !== 200) throw new Error(`공구 정보를 못 받았습니다: ${r.status} ${r.text.slice(0, 200)}`);
  const state = JSON.parse(r.text);
  const groupBuy = state.groupBuys.find((g) => g.slug === SLUG);
  const options = groupBuy.products.flatMap((p) => p.options).filter((o) => o.stockQty == null || o.stockQty - (o.orderedQty ?? 0) > 0);
  return { groupBuyId: groupBuy.id, options };
}

function orderBody(groupBuyId, options, n) {
  const option = options[n % options.length];
  const phone = `010-9${String(n).padStart(3, "0")}-${String(parseInt(runId, 36) % 10000).padStart(4, "0")}`;
  const name = `부하테스트-${runId}-${n}`;
  return {
    groupBuyId,
    lines: [{ optionId: option.id, quantity: 1 + (n % 2) }],
    input: { customerName: name, phone, recipientName: name, recipientPhone: phone, postcode: "", address: "부하테스트 주소", addressDetail: `${n}호`, shippingMessage: "", depositorName: name, pin: "1234" },
    expectedTotal: null,
    source: "form",
  };
}

async function order(groupBuyId, options, n) {
  return timed("order", `${origin}/api/gb/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: origin },
    body: JSON.stringify(orderBody(groupBuyId, options, n)),
  });
}

async function browseUser(spreadMs) {
  await sleep(rand(0, spreadMs));
  if (blocked) return [];
  const page = await timed("page /pants", `${origin}/pants`, { headers: { Accept: "text/html" } });
  await sleep(rand(300, 1500));
  if (blocked) return [page];
  const api = await timed("api public/pants", `${origin}/api/gb/public/${SLUG}`, { headers: { Accept: "application/json" } });
  return [page, api];
}

async function main() {
  console.log(`대상 ${origin} · 모드 ${mode} · run ${runId}`);
  const report = { origin, mode, runId, startedAt: new Date().toISOString(), phases: [] };

  if (mode === "browse") {
    const users = Number(countArg);
    const spreadMs = Number(spreadArg) * 1000;
    console.log(`${users}명이 ${spreadArg}초에 걸쳐 /pants 열기 → 상품 API 조회`);
    const started = performance.now();
    const results = (await Promise.all(Array.from({ length: users }, () => browseUser(spreadMs)))).flat();
    report.phases.push({ name: `browse ${users} over ${spreadArg}s`, wallMs: Math.round(performance.now() - started), summary: summarize(results) });
  } else {
    const { groupBuyId, options } = await loadOptions();
    const waves = mode === "smoke" ? [Number(countArg)] : countArg.split(",").map(Number);
    const spreadMs = Number(spreadArg) * 1000;
    let n = 0;
    const orderNos = [];
    for (const [index, size] of waves.entries()) {
      if (blocked) break;
      if (index > 0) { console.log("  다음 묶음까지 20초 쉼"); await sleep(20_000); }
      console.log(`주문 ${size}건을 ${spreadArg}초 안에 동시 제출`);
      const started = performance.now();
      const ids = Array.from({ length: size }, () => n++);
      const results = await Promise.all(ids.map(async (id) => { await sleep(rand(0, spreadMs)); return blocked ? null : order(groupBuyId, options, id); }));
      const done = results.filter(Boolean);
      for (const r of done) {
        if (r.status !== 200) continue;
        try { const body = JSON.parse(r.text); if (body.ok) orderNos.push(body.order.orderNo); else r.status = `200-${body.code}`; } catch { /* ignore */ }
      }
      const errors = done.filter((r) => r.status !== 200).slice(0, 5).map((r) => `${r.status} ${r.text.slice(0, 160)}`);
      report.phases.push({ name: `orders wave ${size} in ${spreadArg}s`, wallMs: Math.round(performance.now() - started), summary: summarize(done), sampleErrors: errors });
    }
    const duplicates = orderNos.filter((no, i) => orderNos.indexOf(no) !== i);
    report.orders = { accepted: orderNos.length, attempted: n, duplicateOrderNos: duplicates, first: orderNos.sort()[0], last: orderNos.sort().at(-1) };
  }

  report.blocked = blocked;
  report.finishedAt = new Date().toISOString();
  mkdirSync("outputs/loadtest", { recursive: true });
  const file = `outputs/loadtest/${report.startedAt.replace(/[:.]/g, "-")}-${mode}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n저장: ${file}`);
}

main().catch((error) => { console.error(`오류: ${error.message}`); process.exit(1); });

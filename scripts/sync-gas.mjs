#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbwybI81qIBMYN3AYNuPiD4WjPNYHYWa8wkC2tp2Vfx8hedoHKe-boZPa6KRtGZCNoJpXQ/exec';
const OUT_DIR = process.env.OUT_DIR || 'public-data';
const TABS = ['songs', 'gags', 'archive'];
const TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS || 8000);
const MAX_RETRY = Number(process.env.SYNC_MAX_RETRY || 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(tab) {
  const url = new URL(GAS_URL);
  url.searchParams.set('sheet', tab);
  url.searchParams.set('authuser', '0');
  url.searchParams.set('v', String(Date.now()));
  return url.toString();
}

async function fetchJsonWithRetry(tab) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(buildUrl(tab), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const payload = await res.json();
      if (!payload || typeof payload !== 'object') {
        throw new Error('レスポンスがJSONオブジェクトではありません');
      }
      if (!Array.isArray(payload.rows)) {
        throw new Error('rows が配列ではありません');
      }

      return payload;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < MAX_RETRY) {
        await sleep(400 * attempt);
      }
    }
  }

  throw new Error(`[${tab}] 取得失敗: ${String(lastError)}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const outputs = {};
  for (const tab of TABS) {
    const payload = await fetchJsonWithRetry(tab);
    outputs[tab] = {
      ok: true,
      sheet: tab,
      fetchedAt: new Date().toISOString(),
      rows: payload.rows,
      total: payload.total ?? payload.rows.length,
      matched: payload.matched ?? payload.rows.length,
    };
  }

  await Promise.all(
    Object.entries(outputs).map(([tab, payload]) =>
      writeFile(`${OUT_DIR}/${tab}.json`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    )
  );

  const meta = {
    ok: true,
    source: 'gas-sync',
    generatedAt: new Date().toISOString(),
    startedAt,
    tabs: TABS,
    counts: Object.fromEntries(TABS.map((tab) => [tab, outputs[tab].rows.length])),
  };
  await writeFile(`${OUT_DIR}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log('sync complete', meta);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

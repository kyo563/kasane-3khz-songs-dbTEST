#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const GAS_URL = process.env.GAS_URL || 'https://script.google.com/macros/s/AKfycbwybI81qIBMYN3AYNuPiD4WjPNYHYWa8wkC2tp2Vfx8hedoHKe-boZPa6KRtGZCNoJpXQ/exec';
const OUT_DIR = process.env.OUT_DIR || 'public-data';
const TABS = ['songs', 'gags', 'archive'];
const DEFAULT_LIMITS = {
  songs: 200,
  gags: 100,
  archive: 10,
};
const ARCHIVE_MAX_PAGES = Number(process.env.ARCHIVE_MAX_PAGES || 200);
const TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS || 8000);
const MAX_RETRY = Number(process.env.SYNC_MAX_RETRY || 3);

function parseJsonLoose(input) {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  try {
    return JSON.parse(trimmed);
  } catch {
    return input;
  }
}

function resolveRows(payload) {
  const queue = [payload];
  const visited = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) continue;

    if (typeof cur === 'string') {
      const parsed = parseJsonLoose(cur);
      if (parsed !== cur) queue.push(parsed);
      continue;
    }

    if (typeof cur !== 'object') continue;
    if (visited.has(cur)) continue;
    visited.add(cur);

    if (Array.isArray(cur)) {
      if (cur.length === 0 || Array.isArray(cur[0]) || typeof cur[0] === 'object') return cur;
      continue;
    }

    const direct = [
      cur.rows,
      cur.data,
      cur.items,
      cur.list,
      cur.values,
      cur.records,
      cur.result,
      cur.payload,
      cur.response,
      cur.result && cur.result.rows,
      cur.payload && cur.payload.rows,
      cur.response && cur.response.rows,
    ];
    for (const candidate of direct) {
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') queue.push(candidate);
    }

    for (const value of Object.values(cur)) {
      if (value && (typeof value === 'object' || typeof value === 'string')) queue.push(value);
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(tab, offset = 0) {
  const url = new URL(GAS_URL);
  url.searchParams.set('sheet', tab);
  const limit = DEFAULT_LIMITS[tab];
  if (Number.isFinite(limit) && limit > 0) {
    url.searchParams.set('limit', String(limit));
  }
  if (Number.isFinite(offset) && offset > 0) {
    url.searchParams.set('offset', String(Math.floor(offset)));
  }
  url.searchParams.set('authuser', '0');
  url.searchParams.set('v', String(Date.now()));
  return url.toString();
}

async function fetchJsonWithRetry(tab, { offset = 0 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(buildUrl(tab, offset), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      const payload = parseJsonLoose(text);
      const parsedPayload = payload && typeof payload === 'object' ? payload : {};
      if (parsedPayload.ok === false) {
        throw new Error(parsedPayload.error || 'GAS が ok=false を返しました');
      }
      const rawSheet = String(parsedPayload.sheet || '').toLowerCase();
      if ((tab === 'songs' || tab === 'gags') && rawSheet && rawSheet !== tab) {
        throw new Error(`sheet mismatch: request=${tab}, response=${rawSheet}`);
      }

      const rows = resolveRows(payload);
      if (!rows) {
        throw new Error('rows が配列として取得できませんでした');
      }

      const normalized = (rows || [])
        .map((r) => {
          if (Array.isArray(r)) {
            return {
              artist: r[0] ?? '',
              title: r[1] ?? '',
              kind: r[2] ?? '',
              dText: r[3] ?? '',
              dUrl: r[4] ?? '',
            };
          }
          return r && typeof r === 'object' ? r : null;
        })
        .filter((r) => r && typeof r === 'object');

      return {
        sheet: parsedPayload.sheet,
        total: parsedPayload.total,
        matched: parsedPayload.matched,
        rows: normalized,
      };
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

function archiveRowKey(row) {
  return [
    row.artist ?? '',
    row.title ?? '',
    row.kind ?? '',
    row.dText ?? '',
    row.dUrl ?? '',
  ].map((v) => String(v).trim().toLowerCase()).join('|');
}

async function verifyArchiveHealthCheck() {
  const payload = await fetchJsonWithRetry('archive', { offset: 0 });
  if (!Array.isArray(payload.rows)) {
    throw new Error('[archive] health check failed: rows が配列ではありません');
  }
  if (payload.rows.length < 1 && Number(payload.total || 0) > 0) {
    throw new Error('[archive] health check failed: total > 0 なのに rows が空です');
  }
  return payload;
}

async function fetchArchivePaged() {
  const pageLimit = Math.max(1, Math.floor(DEFAULT_LIMITS.archive || 10));
  const merged = [];
  const seen = new Set();
  let previousFirstKey = '';

  for (let page = 0; page < ARCHIVE_MAX_PAGES; page += 1) {
    const offset = page * pageLimit;
    const payload = await fetchJsonWithRetry('archive', { offset });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    console.log(`[archive] page=${page + 1} offset=${offset} rows=${rows.length}`);
    if (rows.length === 0) break;

    const currentFirstKey = archiveRowKey(rows[0]);
    if (page > 0 && currentFirstKey && currentFirstKey === previousFirstKey) {
      break;
    }
    previousFirstKey = currentFirstKey;

    let added = 0;
    for (const row of rows) {
      const key = archiveRowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      added += 1;
    }

    if (added === 0 || rows.length < pageLimit) break;
  }

  return {
    sheet: 'archive',
    total: merged.length,
    matched: merged.length,
    rows: merged,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const outputs = {};
  for (const tab of TABS) {
    const payload = tab === 'archive'
      ? (await verifyArchiveHealthCheck(), await fetchArchivePaged())
      : await fetchJsonWithRetry(tab);
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

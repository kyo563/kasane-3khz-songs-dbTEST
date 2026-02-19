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

function isArgumentTooLargeError(err) {
  const msg = String(err?.message ?? err);
  return (
    msg.includes('Argument too large')
    || msg.includes('引数が大きすぎます')
    || msg.includes('Exception: Argument too large')
  );
}

function buildUrl(tab, { offset = 0, limit } = {}) {
  const url = new URL(GAS_URL);
  url.searchParams.set('sheet', tab);
  const resolvedLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMITS[tab];
  if (Number.isFinite(resolvedLimit) && resolvedLimit > 0) {
    url.searchParams.set('limit', String(resolvedLimit));
  }
  if (Number.isFinite(offset) && offset > 0) {
    url.searchParams.set('offset', String(Math.floor(offset)));
  }
  url.searchParams.set('authuser', '0');
  url.searchParams.set('v', String(Date.now()));
  return url.toString();
}

async function fetchJsonWithRetry(tab, { offset = 0, limit } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(buildUrl(tab, { offset, limit }), {
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

async function fetchArchiveWithBackoff(buildUrlFn) {
  const limits = (process.env.ARCHIVE_LIMITS ?? '120,80,50,30,20,10')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  let lastErr;
  for (const limit of limits) {
    try {
      buildUrlFn({ sheet: 'archive', limit });
      return await fetchJsonWithRetry('archive', { limit });
    } catch (e) {
      lastErr = e;
      if (!isArgumentTooLargeError(e)) throw e;
      console.warn(`[archive] limit=${limit} で失敗（Argument too large）→ 縮小して再試行します`);
    }
  }
  throw lastErr;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const outputs = {};
  for (const tab of TABS.filter((t) => t !== 'archive')) {
    const payload = await fetchJsonWithRetry(tab);
    outputs[tab] = {
      ok: true,
      sheet: tab,
      fetchedAt: new Date().toISOString(),
      rows: payload.rows,
      total: payload.total ?? payload.rows.length,
      matched: payload.matched ?? payload.rows.length,
    };
    await writeFile(`${OUT_DIR}/${tab}.json`, `${JSON.stringify(outputs[tab], null, 2)}\n`, 'utf8');
  }

  try {
    await verifyArchiveHealthCheck();
    const archive = await fetchArchiveWithBackoff(({ sheet, limit }) => {
      const url = new URL(GAS_URL);
      url.searchParams.set('sheet', sheet);
      url.searchParams.set('limit', String(limit));
      return url.toString();
    });
    const archivePayload = {
      ok: true,
      sheet: 'archive',
      fetchedAt: new Date().toISOString(),
      rows: archive.rows,
      total: archive.total ?? archive.rows.length,
      matched: archive.matched ?? archive.rows.length,
    };
    outputs.archive = archivePayload;
    await writeFile(`${OUT_DIR}/archive.json`, `${JSON.stringify(archivePayload, null, 2)}\n`, 'utf8');
  } catch (e) {
    if (isArgumentTooLargeError(e)) {
      console.warn('[archive] 全limitで失敗。前回の public-data/archive.json を維持して続行します');
    } else {
      throw e;
    }
  }

  const meta = {
    ok: true,
    source: 'gas-sync',
    generatedAt: new Date().toISOString(),
    startedAt,
    tabs: TABS,
    counts: Object.fromEntries(TABS.map((tab) => [tab, outputs[tab]?.rows?.length ?? null])),
  };
  await writeFile(`${OUT_DIR}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log('sync complete', meta);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

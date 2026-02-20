/**
 * kasane-3khz-songs-db 用 Google Apps Script
 *
 * 期待仕様:
 * - GET /exec?sheet=songs|gags|archive[&q=...&artist=...&title=...&exact=1&limit=...&offset=...&debug=1]
 * - 返却: { ok, sheet, total, matched, offset, limit, rows }
 * - rows: [{ artist, title, kind, dText, dUrl, date8, rowId, (debug時のみ)dSrc }]
 * - callback 指定時は JSONP を返す
 */

const CFG = {
  SHEET_ID: '1_eZ-WFkWIpx_g_oxQWbc3_uMCqdjybsQNkvckWbQFUw',
  SHEETS: {
    songs: '歌った曲リスト',
    gags: '企画/一発ネタシリーズ',
    archive: 'アーカイブ',
  },
  START_ROWS: {
    songs: 4,
    gags: 4,
    archive: 4,
  },
  COLS: 4,
  MAX_RETURN: 5000,
  SHEET_MAX_RETURN: {
    songs: 5000,
    gags: 5000,
    archive: 5000,
  },
  CACHE_SECONDS: 60,
  SHEET_CACHE_SECONDS: {
    songs: 60,
    gags: 60,
    archive: 60,
  },
  CACHE_MAX_BYTES: 95 * 1024,
};

function doGet(e) {
  try {
    const payload = main_(e);
    return out_(payload, e);
  } catch (err) {
    return out_({ ok: false, error: String(err) }, e);
  }
}

function main_(e) {
  const p = (e && e.parameter) || {};
  const tabKey = String(p.sheet || 'songs').trim().toLowerCase();
  const sheetName = CFG.SHEETS[tabKey];
  if (!sheetName) throw new Error('unknown sheet: ' + tabKey);

  const startRow = CFG.START_ROWS[tabKey] || 4;
  const includeSrc = String(p.debug || '') === '1';
  const result = readSheet_(sheetName, startRow, includeSrc, tabKey);
  const rows = result.rows || [];

  const q = normalize_(p.q || '');
  const exactArtist = normalize_(p.artist || '');
  const exactTitle = normalize_(p.title || '');
  const exact = String(p.exact || '') === '1';
  const limitParam = Number(p.limit || 0);
  const offsetParam = Number(p.offset || 0);
  const sheetMaxReturn = CFG.SHEET_MAX_RETURN[tabKey] || CFG.MAX_RETURN;

  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), sheetMaxReturn)
    : sheetMaxReturn;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0
    ? Math.floor(offsetParam)
    : 0;

  let filtered = rows;
  if (exact && exactArtist && exactTitle) {
    filtered = rows.filter((r) =>
      normalize_(r.artist) === exactArtist && normalize_(r.title) === exactTitle
    );
  } else if (q) {
    filtered = filtered.filter((r) =>
      normalize_(r.artist).includes(q) || normalize_(r.title).includes(q)
    );
  }

  const uniq = uniqueByKey_(
    filtered,
    (r) => `${normalize_(r.artist)}|${normalize_(r.title)}|${r.dUrl || ''}`
  );

  const sorted = uniq.sort((a, b) => extractDate8_(b.dText) - extractDate8_(a.dText));

  return {
    ok: true,
    sheet: tabKey,
    total: rows.length,
    matched: sorted.length,
    offset,
    limit,
    rows: sorted.slice(offset, offset + limit),
  };
}

function out_(payload, e) {
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    const isValid = /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(cb);
    const body = isValid ? `${cb}(${JSON.stringify(payload)})` : '/* invalid callback */';
    return ContentService
      .createTextOutput(body)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readSheet_(sheetName, startRow, includeSrc, tabKey) {
  const cacheKey = `rows:${sheetName}:${startRow}:${includeSrc ? 'withSrc' : 'noSrc'}`;
  const cacheSeconds = CFG.SHEET_CACHE_SECONDS[tabKey] || CFG.CACHE_SECONDS;

  if (cacheSeconds > 0) {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(cacheKey);
    if (hit) {
      try {
        return JSON.parse(hit);
      } catch (err) {
        // 壊れたキャッシュは読み捨て
      }
    }
  }

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('指定シートが見つかりません: ' + sheetName);

  const last = sh.getLastRow();
  if (last < startRow) return { rows: [] };

  const numRows = last - startRow + 1;
  const range = sh.getRange(startRow, 1, numRows, CFG.COLS);
  const values = range.getDisplayValues();
  const formulas = range.getFormulas();
  const rich = range.getRichTextValues();

  const parsed = [];
  for (let i = 0; i < numRows; i += 1) {
    const artist = values[i][0] || '';
    const title = values[i][1] || '';
    const kind = values[i][2] || '';
    const dText = values[i][3] || '';

    if ((artist + title).trim() === '') continue;

    const link = getUrlWithSource_(rich[i][3], formulas[i][3], dText);
    const date8 = extractDate8_(dText);
    const row = {
      artist,
      title,
      kind,
      dText,
      dUrl: link.url,
      date8,
      rowId: buildRowId_(artist, title, kind, link.url),
    };
    if (includeSrc) row.dSrc = link.src;
    parsed.push(row);
  }

  const uniq = uniqueByKey_(
    parsed,
    (r) => `${normalize_(r.artist)}|${normalize_(r.title)}|${r.dUrl || ''}`
  );

  const output = { rows: uniq };
  if (cacheSeconds > 0) {
    putCacheIfSmall_(CacheService.getScriptCache(), cacheKey, output, cacheSeconds);
  }

  return output;
}

function putCacheIfSmall_(cache, key, value, ttlSeconds) {
  try {
    const serialized = JSON.stringify(value);
    const byteLength = Utilities.newBlob(serialized).getBytes().length;
    if (byteLength > CFG.CACHE_MAX_BYTES) return false;
    cache.put(key, serialized, ttlSeconds);
    return true;
  } catch (err) {
    return false;
  }
}

function uniqueByKey_(arr, keyFn) {
  const seen = new Set();
  const out = [];

  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function getUrlWithSource_(rtv, formula, dText) {
  const fromRich = pickUrlFromRich_(rtv);
  if (fromRich) return { url: fromRich, src: 'rich' };

  const fromFormula = pickUrlFromFormula_(formula);
  if (fromFormula) return { url: fromFormula, src: 'formula' };

  const fromText = pickUrlFromText_(dText);
  if (fromText) return { url: fromText, src: 'text' };

  return { url: '', src: 'none' };
}

function pickUrlFromRich_(rtv) {
  if (!rtv) return '';

  try {
    const direct = rtv.getLinkUrl && rtv.getLinkUrl();
    if (direct) return String(direct).trim();
  } catch (err) {
    // noop
  }

  try {
    const runs = rtv.getRuns ? rtv.getRuns() : [];
    for (let i = 0; i < runs.length; i += 1) {
      const style = runs[i].getTextStyle && runs[i].getTextStyle();
      const link = style && style.getLinkUrl && style.getLinkUrl();
      if (link) return String(link).trim();
    }
  } catch (err) {
    // noop
  }

  return '';
}

function pickUrlFromFormula_(formula) {
  if (!formula) return '';

  let m = formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
  if (m) return m[1].trim();

  m = formula.match(/HYPERLINK\(\s*'([^']+)'/i);
  if (m) return m[1].trim();

  m = formula.match(/href="([^"]+)"/i);
  if (m) return m[1].trim();

  m = formula.match(/HYPERLINK\(&quot;([^&]+)&quot;/i);
  if (m) return m[1].trim();

  return '';
}

function pickUrlFromText_(text) {
  if (!text) return '';
  const m = String(text).match(/https?:\/\/\S+/i);
  return m ? m[0].trim() : '';
}

function normalize_(text) {
  if (text == null) return '';

  let s = String(text);
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\u3000/g, ' ');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}


function buildRowId_(artist, title, kind, dUrl) {
  return [
    normalize_(artist || ''),
    normalize_(title || ''),
    normalize_(kind || ''),
    String(dUrl || '').trim(),
  ].join('|');
}

function extractDate8_(text) {
  const m = String(text || '').match(/^(\d{8})/);
  return m ? Number(m[1]) : 0;
}

/**
 * 任意の簡易診断
 */
function probeOne_(tabKey) {
  const key = String(tabKey || '').toLowerCase();
  const sheetName = CFG.SHEETS[key];
  if (!sheetName) return { error: 'unknown sheet: ' + tabKey };

  const startRow = CFG.START_ROWS[key] || 4;
  const rows = readSheet_(sheetName, startRow, true, key).rows || [];

  const summary = {
    sheetName,
    startRow,
    total: rows.length,
    withUrl: 0,
    withoutUrl: 0,
    breakdown: { rich: 0, formula: 0, text: 0, none: 0 },
    samples: { withUrl: [], withoutUrl: [] },
  };

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const hasUrl = !!r.dUrl;

    if (hasUrl) {
      summary.withUrl += 1;
      if (summary.samples.withUrl.length < 5) {
        summary.samples.withUrl.push({ idx: i + startRow, artist: r.artist, title: r.title, dText: r.dText, dUrl: r.dUrl, dSrc: r.dSrc });
      }
    } else {
      summary.withoutUrl += 1;
      if (summary.samples.withoutUrl.length < 5) {
        summary.samples.withoutUrl.push({ idx: i + startRow, artist: r.artist, title: r.title, dText: r.dText, dSrc: r.dSrc });
      }
    }

    if (r.dSrc === 'rich' || r.dSrc === 'formula' || r.dSrc === 'text') {
      summary.breakdown[r.dSrc] += 1;
    } else {
      summary.breakdown.none += 1;
    }
  }

  summary.rate = summary.total > 0
    ? Number(((summary.withUrl / summary.total) * 100).toFixed(2))
    : 0;

  return summary;
}

function probeAll_() {
  const report = {};
  Object.keys(CFG.SHEETS).forEach((key) => {
    report[key] = probeOne_(key);
  });
  return report;
}

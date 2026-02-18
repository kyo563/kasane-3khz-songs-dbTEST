doget

/***** 設定 *****/
const CFG = {
  SHEET_ID: '1_eZ-WFkWIpx_g_oxQWbc3_uMCqdjybsQNkvckWbQFUw',
  SHEETS: {
    songs:   '歌った曲リスト',
    gags:    '企画/一発ネタシリーズ',
    archive: 'アーカイブ',
  },
  // シート別の開始行（1始まり）。アーカイブは A2 から。
  START_ROWS: {
    songs:   4,
    gags:    4,
    archive: 2,
  },
  COLS: 4,           // A:D (A:アーティスト, B:曲名, C:区分, D:出典)
  MAX_RETURN: 5000,  // サーバ側の最大返却件数
  CACHE_SECONDS: 60  // キャッシュ不要なら 0
};

/***** エントリーポイント（本番ラッパ） *****/
function doGet(e) {
  try {
    const payload = main_(e);
    return out_(payload, e);
  } catch (err) {
    return out_({ ok:false, error:String(err) }, e);
  }
}

/***** 本処理 *****/
function main_(e) {
  const p = (e && e.parameter) || {};
  const tabKey = String(p.sheet || 'songs').trim().toLowerCase();
  const sheetName = CFG.SHEETS[tabKey];
  if (!sheetName) throw new Error('unknown sheet: ' + tabKey);

  // 読み込み（行開始はシート別）
  const startRow = CFG.START_ROWS[tabKey] || 4;
  const includeSrc = String(p.debug || '') === '1';
  const { rows } = readSheet_(sheetName, startRow, includeSrc);

  // サーバ側フィルタ（任意）
  const q = normalize_(p.q || '');
  const limitParam = Number(p.limit || 0);
  const limit = (Number.isFinite(limitParam) && limitParam > 0)
    ? Math.min(limitParam, CFG.MAX_RETURN)
    : CFG.MAX_RETURN;

  let filtered = rows;
  if (q) {
    filtered = rows.filter(r =>
      normalize_(r.artist).includes(q) || normalize_(r.title).includes(q)
    );
  }

  // 最終的にも一応ユニーク化（artist|title|dUrl）
  const uniq = uniqueByKey_(filtered, r => `${normalize_(r.artist)}|${normalize_(r.title)}|${r.dUrl||''}`);

  const out = uniq.slice(0, limit);
  return {
    ok: true,
    sheet: tabKey,
    total: rows.length,
    matched: uniq.length,
    rows: out // {artist,title,kind,dText,dUrl,(debug時のみ dSrc)}
  };
}

/***** JSON / JSONP 自動切替 *****/
function out_(payload, e) {
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    const ok = /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(cb);
    const body = ok ? `${cb}(${JSON.stringify(payload)})` : '/* invalid callback */';
    return ContentService.createTextOutput(body)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/***** シート読取（A:B:C:D）— D はリンク抽出対応 + サーバ側ユニーク化 *****/
function readSheet_(sheetName, startRow, includeSrc) {
  const cacheKey = `rows:${sheetName}:${startRow}:${includeSrc ? 'withSrc' : 'noSrc'}`;
  if (CFG.CACHE_SECONDS > 0) {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('指定シートが見つかりません: ' + sheetName);

  const last = sh.getLastRow();
  if (last < startRow) return { rows: [] };

  const numRows = last - startRow + 1;
  const rng = sh.getRange(startRow, 1, numRows, CFG.COLS);

  const values   = rng.getDisplayValues();   // 表示文字
  const formulas = rng.getFormulas();        // =HYPERLINK() など
  const rich     = rng.getRichTextValues();  // リッチテキスト

  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const artist = values[i][0] || '';
    const title  = values[i][1] || '';
    const kind   = values[i][2] || '';
    const dText  = values[i][3] || ''; // 表示名（D）

    // A/B が完全空欄はスキップ
    if ((artist + title).trim() === '') continue;

    // DのURL：RichText → HYPERLINK関数 → 生URL の順（診断時はソースも返す）
    const { url: dUrl, src: dSrc } = getUrlWithSource_(rich[i][3], formulas[i][3], dText);

    const row = { artist, title, kind, dText, dUrl };
    if (includeSrc) row.dSrc = dSrc; // 'rich'|'formula'|'text'|'none'
    rows.push(row);
  }

  // サーバ側でもユニーク化（artist|title|dUrl）
  const uniq = uniqueByKey_(rows, r => `${normalize_(r.artist)}|${normalize_(r.title)}|${r.dUrl||''}`);

  if (CFG.CACHE_SECONDS > 0) {
    const cache = CacheService.getScriptCache();
    cache.put(cacheKey, JSON.stringify({ rows: uniq }), CFG.CACHE_SECONDS);
  }
  return { rows: uniq };
}

/***** ユーティリティ：配列のユニーク化 *****/
function uniqueByKey_(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/***** URL と取得元ソースを同時に判断 *****/
function getUrlWithSource_(rtv, formula, dText) {
  // 1) リッチテキスト（セル全体リンク or 部分 runs のリンク）
  const u1 = pickUrlFromRich_(rtv);
  if (u1) return { url: u1, src: 'rich' };

  // 2) 数式（=HYPERLINK(...), aタグなど）
  const u2 = pickUrlFromFormula_(formula);
  if (u2) return { url: u2, src: 'formula' };

  // 3) プレーンテキスト中のURL
  const u3 = pickUrlFromText_(dText);
  if (u3) return { url: u3, src: 'text' };

  return { url: '', src: 'none' };
}

/***** 診断：全シート・単一シート（必要なら残す） *****/
function probeAll_() {
  const report = {};
  Object.keys(CFG.SHEETS).forEach(key => {
    report[key] = probeOne_(key);
  });
  return report;
}
function probeOne_(tabKey) {
  const sheetName = CFG.SHEETS[tabKey];
  if (!sheetName) return { error: 'unknown sheet: ' + tabKey };

  const startRow = CFG.START_ROWS[tabKey] || 4;
  const { rows } = readSheet_(sheetName, startRow, true);
  const total = rows.length;

  let withUrl = 0, rich = 0, formula = 0, text = 0, none = 0;
  const noUrlSamples = [];
  const urlSamples = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const has = !!r.dUrl;
    if (has) {
      withUrl++;
      if (urlSamples.length < 5) urlSamples.push({ idx: i + startRow, artist: r.artist, title: r.title, dText: r.dText, dUrl: r.dUrl, dSrc: r.dSrc });
    } else {
      if (noUrlSamples.length < 5) noUrlSamples.push({ idx: i + startRow, artist: r.artist, title: r.title, dText: r.dText, dSrc: r.dSrc });
    }
    if (r.dSrc === 'rich') rich++;
    else if (r.dSrc === 'formula') formula++;
    else if (r.dSrc === 'text') text++;
    else none++;
  }

  return {
    sheetName, startRow, total,
    withUrl, withoutUrl: total - withUrl,
    rate: total ? +(withUrl / total * 100).toFixed(2) : 0,
    breakdown: { rich, formula, text, none },
    samples: { withUrl: urlSamples, withoutUrl: noUrlSamples }
  };
}

/***** URL 抽出ヘルパ *****/
function pickUrlFromRich_(rtv) {
  if (!rtv) return '';
  try {
    const u = rtv.getLinkUrl && rtv.getLinkUrl();
    if (u) return String(u).trim();
  } catch (e) {}
  try {
    const runs = rtv.getRuns ? rtv.getRuns() : [];
    for (let i = 0; i < runs.length; i++) {
      const style = runs[i].getTextStyle && runs[i].getTextStyle();
      const u = style && style.getLinkUrl && style.getLinkUrl();
      if (u) return String(u).trim();
    }
  } catch (e) {}
  return '';
}
function pickUrlFromFormula_(f) {
  if (!f) return '';
  let m = f.match(/HYPERLINK\(\s*"([^"]+)"/i);
  if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(\s*'([^']+)'/i);
  if (m) return m[1].trim();
  m = f.match(/href="([^"]+)"/i);
  if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(&quot;([^&]+)&quot;/i);
  if (m) return m[1].trim();
  return '';
}
function pickUrlFromText_(s) {
  if (!s) return '';
  const m = String(s).match(/https?:\/\/\S+/i);
  return m ? m[0].trim() : '';
}

/***** 文字正規化 *****/
function normalize_(s) {
  if (s == null) return '';
  s = String(s).replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\u3000/g, ' ');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

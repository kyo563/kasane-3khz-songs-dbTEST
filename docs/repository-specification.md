# kasane-3khz-songs-db 仕様書（リポジトリ全体）

> 本書は、このリポジトリに含まれる主要ファイルを対象に、**目的・要件・データ仕様・実行構成・運用上の注意点**を1つに統合した詳細仕様書です。

---

## 1. システム概要

### 1.1 目的
- 配信者「花彩音_3kHz」の楽曲データ（歌唱曲 / 一発ネタ）を検索・閲覧するための静的フロントエンドを提供する。
- データソースは Google Apps Script（以下 GAS）経由のスプレッドシートで、運用時は `public-data/*.json` の静的スナップショット（R2 配信を含む）を優先利用する。

### 1.2 基本アーキテクチャ
1. GAS API から `songs` / `gags`（必要に応じて `archive`）を取得。
2. `scripts/sync-gas.mjs` が正規化して `public-data/*.json` を生成。
3. GitHub Actions が定期実行し、
   - Git 管理リポジトリにスナップショット反映（`sync-gas.yml`）
   - Cloudflare R2 へアップロード（`sync-r2.yml`）
4. `index.html` が `songs/gags/meta` を静的 JSON から読み込み、履歴（archive）は必要時に API 取得して表示。

---

## 2. ディレクトリ/ファイル構成（仕様観点）

- `README.md`
  - リポジトリの正規運用フロー（同期対象、`archive` の扱い、R2 利用方法）を記載。
- `index.html`
  - 単一ファイルのフロントエンド本体（HTML/CSS/JavaScript 同居）。
- `scripts/sync-gas.mjs`
  - GAS 同期バッチ。JSON 正規化・再試行・archive ページング・メタファイル生成を担当。
- `.github/workflows/sync-gas.yml`
  - 15分ごとのスナップショット更新（Git commit/push）。
- `.github/workflows/sync-r2.yml`
  - 30分ごとの R2 反映（songs/gags/meta のみ）。
- `public-data/*.json`
  - 静的配信データ（実データ・メタデータ）。
- `google-apps-script-reference/code.gs`
  - 参照用の GAS 実装（このリポジトリでは変更しない方針）。
- `docs/cloudflare-r2-setup.md`
  - R2 接続手順。
- `docs/streamlit_stability_eval.md`
  - Streamlit 側の安定化評価メモ。
- `google-apps-script-reference/README.md`
  - 参照用 GAS の位置づけ（運用対象外）を明記。

---

## 3. データ仕様（API / JSON 共通）

### 3.1 行データの標準スキーマ
行オブジェクトは原則として次を持つ。

```json
{
  "artist": "アーティスト名",
  "title": "曲名",
  "kind": "区分(歌枠/ショート/ネタ歌枠など)",
  "dText": "配信情報テキスト(先頭8桁が日付の場合あり)",
  "dUrl": "URL",
  "date8": 20260213,
  "rowId": "artist|title|kind|dUrl"
}
```

### 3.2 日付・一意キー
- `date8`: `dText` 先頭の `YYYYMMDD` を抽出し数値化。未抽出時は `0`。
- `rowId`: `artist/title/kind/dUrl` 正規化連結で生成。重複除去や履歴統合に利用。

### 3.3 タブ別 JSON 形式
- `songs.json` / `gags.json` / `archive.json`
  - `{ ok, sheet, fetchedAt, rows, total, matched }`
- `meta.json`
  - `{ ok, source, generatedAt, startedAt, tabs, counts }`

`meta.counts` と実データ件数の整合性が、フロントの読み込み採否判定に使われる。

---

## 4. フロントエンド仕様（`index.html`）

### 4.1 画面構成
- 一覧ページ（歌唱曲 / 一発ネタタブ）
  - 検索ボックス
  - kind フィルタ（チップ）
  - テーブル/モバイルカード表示
  - 各行の操作（リンク、履歴、コピー）
- 履歴ページ
  - 曲単位の履歴（新しい順）
  - 戻る導線

### 4.2 データ読込戦略
1. `songs/gags/meta` を `STATIC_DATA_BASE` から取得（`static_base` クエリ or `localStorage.staticDataBase` で変更可）。
2. `meta.tabs` と `meta.counts` で整合性検証。
3. 不整合時は当該静的データを不採用。
4. 履歴 (`archive`) は API から動的取得（必要時）。

### 4.3 API URL 解決仕様
- `gas_url` クエリ
- `localStorage.gasApiUrl`
- デフォルト GAS URL
の優先順で決定。

### 4.4 通信方式
- JSONP と fetch(CORS) の二系統を持つ。
- 失敗時のフォールバック、タイムアウト、リトライ段階取得を実装。
- `sheet` 不一致などの検証エラーは別経路（deploy URL）へ再試行。

### 4.5 正規化・互換吸収
複数命名（`artist`, `Artist`, `songName`, `アーティスト名` 等）から標準キーに寄せる。
レスポンス構造も `rows/data/items/result/payload/...` を探索して配列抽出する。

### 4.6 履歴取得ロジック（archive）
- `exact=1` + `artist/title` 指定による絞り込み取得を活用。
- 引数超過（Argument too large）対策として `limit` 縮小候補で再試行。
- ページング (`offset`) と重複排除でチャンク取得。
- `historyCache` に TTL 付きキャッシュ。

### 4.7 UI/UX 仕様
- モバイル時: カード表示、フィルタ自動折りたたみ、スクロール連動背景グラデーション。
- コピー導線:
  - 曲名/アーティストのペアコピー
  - 弾幕テンプレ文字列コピー
- サーバー状態表示:
  - 稼働中 / 非稼働 / 読み込み中（簡易ヘルス指標）。

### 4.8 フロント側の安全対策
- JSONP callback 名の正規表現検証。
- API URL 制限（`https` / ホスト固定 / GAS パス形式検証）。
- fetch タイムアウト + 例外メッセージ整形。

#### 抜粋（URL 検証仕様）

```js
function toSafeApiBase(rawUrl){
  const src = String(rawUrl || '').replace(/\/macros\/u\/\d+\//,'/macros/');
  const u = new URL(src);
  if (u.protocol !== 'https:') throw new Error('API URLはhttpsのみ許可しています');
  if (u.hostname !== JSONP_ALLOWED_ORIGIN) throw new Error('許可されていないJSONPホストです');
  if (!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)) throw new Error('API URL形式が不正です');
  return u;
}
```

---

## 5. 同期バッチ仕様（`scripts/sync-gas.mjs`）

### 5.1 役割
- GAS レスポンスを取得し、`public-data/songs.json` と `gags.json` を更新。
- 条件付きで `archive.json` を同期。
- `meta.json` を生成。

### 5.2 環境変数
主要パラメータ:
- `GAS_URL`
- `OUT_DIR`（既定 `public-data`）
- `ENABLE_ARCHIVE_SYNC`（`true` のとき archive 同期）
- `ARCHIVE_STRICT_SYNC`（archive 失敗を致命扱いするか）
- `ARCHIVE_LIMITS`（既定 `20,10,5,3,1`）
- `ARCHIVE_PAGE_LIMIT`（既定 `5`）
- `ARCHIVE_MAX_PAGES`（既定 `4000`）
- `ARCHIVE_TOTAL_CAP`（既定 `20000`）
- `SYNC_TIMEOUT_MS`（既定 `8000`）
- `SYNC_MAX_RETRY`（既定 `3`）

### 5.3 レスポンス吸収・正規化
- JSON文字列/オブジェクトのゆれを `parseJsonLoose` で吸収。
- `resolveRows` で多様な配列配置（`rows/data/items/...`）を探索。
- 配列形式とオブジェクト形式の両方を標準化し、`date8` / `rowId` を補完。

### 5.4 archive の堅牢化設計
- 事前ヘルスチェック (`limit=1`)。
- `ARG_TOO_LARGE` を検出して `limit` を段階的縮小。
- `offset` ページングで全量収集し、重複をキーで除去。
- 上限 (`ARCHIVE_TOTAL_CAP`) と同一ページ応答検知で暴走防止。

### 5.5 出力仕様
- `songs.json`, `gags.json` は毎回再生成。
- `archive` は `ENABLE_ARCHIVE_SYNC=true` のときのみ生成更新。
- `meta.tabs` は実際に出力したタブ一覧。

#### 抜粋（archive 同期スキップ時）
```js
if (ENABLE_ARCHIVE_SYNC) {
  // 取得処理
} else {
  console.warn('[archive] ENABLE_ARCHIVE_SYNC=true になるまで archive の取得をスキップします（隔離中）');
}
```

---

## 6. GitHub Actions 仕様

### 6.1 `sync-gas.yml`
- 実行契機: 手動 + 15分間隔 cron。
- Node.js 20 で `node scripts/sync-gas.mjs` 実行。
- `ENABLE_ARCHIVE_SYNC=false`（archive は同期しない）
- 差分があれば `public-data/*.json` を自動 commit/push。

### 6.2 `sync-r2.yml`
- 実行契機: 手動 + 30分間隔 cron。
- `sync-gas.mjs` 実行後、AWS CLI で R2 にアップロード。
- 対象は `songs.json/gags.json/meta.json`。
- `archive.json` は R2 から削除（`aws s3 rm`）。
- 3回までリトライして失敗時終了。

### 6.3 Secret 要件
- `GAS_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_BUCKET`

---

## 7. 参照用 GAS 実装仕様（`google-apps-script-reference/code.gs`）

> 本リポジトリでは**参照専用**。運用変更の直接対象ではない。

### 7.1 エンドポイント仕様
- `GET /exec?sheet=songs|gags|archive&...`
- パラメータ:
  - `q`（部分一致）
  - `artist/title/exact=1`（完全一致）
  - `limit/offset`
  - `debug=1`（`dSrc` を追加）
  - `callback`（JSONP化）

### 7.2 シート読取
- シート定義: `songs/gags/archive` をそれぞれ日本語シート名にマッピング。
- 開始行: いずれも 4 行目。
- 取得列: A〜D（4列）。

### 7.3 URL 抽出優先順位
1. RichText link
2. HYPERLINK formula
3. dText 内 URL 正規表現

### 7.4 キャッシュ仕様
- `CacheService.getScriptCache()` を使用。
- タブ別 TTL (`SHEET_CACHE_SECONDS`)。
- JSON のバイトサイズが `CACHE_MAX_BYTES` 超の場合はキャッシュしない。

### 7.5 archive exact 最適化
- `readArchiveExactRows_()` は 200 行チャンクで走査。
- 一致行のみ収集し、必要件数 (`offset+limit`) を満たした後は収集を抑制。

---

## 8. 静的データファイル仕様（`public-data/*.json`）

### 8.1 `songs.json`
- `sheet: "songs"`
- 実データ行配列（429件時点）
- `rowId` は lower-case 化された URL を含む形式

### 8.2 `gags.json`
- `sheet: "gags"`
- 実データ行配列（42件時点）

### 8.3 `archive.json`
- 現在は隔離運用想定のため、空配列スナップショットが配置されることがある。

### 8.4 `meta.json`
- 同期ジョブ単位の生成時刻、対象タブ、件数整合に利用。

---

## 9. ドキュメントファイルの役割

### 9.1 `README.md`
- 最短で運用全体像を把握するための正規入口。
- `archive` の扱い（フロント直接取得/同期隔離）や R2 切替方法を明記。

### 9.2 `docs/cloudflare-r2-setup.md`
- 初心者向け手順。
- Secrets 設定、動作確認、CORS トラブル対処を明文化。

### 9.3 `docs/streamlit_stability_eval.md`
- 現状分析 + Streamlit 側での可用性向上策（再試行、キャッシュ、フォールバック等）を整理。

### 9.4 `google-apps-script-reference/README.md`
- 参照用 GAS の位置づけを簡潔に宣言。

---

## 10. 運用要件・非機能要件（実装から読み取れるもの）

### 10.1 可用性
- フロントは static JSON 優先で、GAS への依存を局所化。
- 通信失敗時の UI 劣化（メッセージ）を実装し、無言失敗を避ける。

### 10.2 一貫性
- `meta.json` による件数突合を実施。
- 同期時に `rowId/date8` を補完し、データの比較可能性を担保。

### 10.3 性能
- 初期表示では songs/gags をまとめて事前読み込み。
- 履歴は必要時取得 + キャッシュ。
- archive はページング・上限で過大取得を抑止。

### 10.4 保守性
- 参照用 GAS を別ディレクトリに分離。
- 同期ロジックを `scripts/sync-gas.mjs` に集中。
- 運用ドキュメント（R2 手順）を docs に明示。

---

## 11. 既知の設計判断（意図）

1. `archive` を static 配信対象から実質外している（`ENABLE_ARCHIVE_SYNC=false` / R2 から削除）
   - 理由: サイズ・引数超過・取得安定性の観点で分離運用。
2. フロントで JSONP / fetch を共存
   - CORS・環境差に備えた冗長経路。
3. レスポンス構造ゆれに強いパーサ
   - GAS 側変更や異常系の吸収を目的。

---

## 12. 仕様確認時の推奨チェックポイント

- `public-data/meta.json` の `tabs` と `counts` が期待どおりか。
- `songs.json`/`gags.json` の `rowId`・`date8` が補完されているか。
- `index.html` を `?static_base=<R2 URL>` 付きで開いたとき静的読込が成功するか。
- Actions の定期実行が成功し、データ更新サイクルが維持されているか。

---

## 13. 変更時の注意（将来作業者向け）

- `index.html` は単一ファイルに多機能が集中しているため、
  - 取得系（fetch/jsonp/normalize）
  - 表示系（render/history）
  - 状態管理（`state`）
  を分けてレビューすること。
- `scripts/sync-gas.mjs` の archive パラメータは、GAS 側負荷・失敗率に直結する。
- `meta.json` 整合チェックを壊すと、フロントが静的データを不採用にする可能性がある。

---

## 14. 参考コード断片（要点）

### 14.1 同期対象コアタブ
```js
const CORE_TABS = ['songs', 'gags'];
```

### 14.2 メタ生成
```js
const meta = {
  ok: true,
  source: 'gas-sync',
  generatedAt: new Date().toISOString(),
  startedAt,
  tabs: outputTabs,
  counts: Object.fromEntries(outputTabs.map((tab) => [tab, outputs[tab]?.rows?.length ?? null])),
};
```

### 14.3 フロント静的URL組み立て
```js
function buildStaticDataUrl(tab){
  const base = new URL(STATIC_DATA_BASE, window.location.href);
  const filename = tab === 'meta' ? 'meta.json' : `${tab}.json`;
  return new URL(filename, base).toString();
}
```

---

## 15. まとめ

本リポジトリは、
- **静的 JSON 中心の配信**（songs/gags）
- **必要時のみ動的取得**（archive）
- **GitHub Actions + R2 での定期配信更新**
を軸に、軽量な単一 HTML フロントと堅牢化された同期スクリプトで構成される。

特に、データ整合 (`meta`)・レスポンスゆれ吸収・archive の制御（limit/backoff/paging）が、運用安定性を支える主要仕様である。

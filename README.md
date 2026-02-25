# kasane-3khz-songs-db

Cloudflare R2 で配信する静的 JSON（`songs` / `gags` / `meta`）を一次データとして使い、`archive` は必要時のみ GAS から動的取得するリポジトリです。

## 1. このリポジトリの役割

- **データ同期**: `scripts/sync-gas.mjs` が GAS からデータを取得し、`public-data/*.json` を更新します。
- **静的配信**: `public-data` を R2 などへ公開し、フロントはそちらを優先読込します。
- **クライアント UI**: `index.html` は `songs` / `gags` の検索を高速表示し、履歴（`archive`）のみオンデマンドで取得します。

## 2. ディレクトリ構成

- `index.html`
  - 検索 UI 本体。
  - `songs` / `gags` は静的 JSON を優先し、`archive` は JSONP で動的取得。
- `scripts/sync-gas.mjs`
  - GAS 取得・正規化・保存・`meta.json` 生成。
- `public-data/*.json`
  - 配信対象スナップショット。
- `google-apps-script-reference/code.gs`
  - 参照用（運用で直接編集しない想定）。
- `docs/*.md`
  - 運用資料。

## 3. 同期フロー（`scripts/sync-gas.mjs`）

1. `songs` / `gags` を必ず取得。
2. 各行を正規化し、`date8` と `rowId` を補完。
3. `public-data/songs.json` と `public-data/gags.json` を保存。
4. `ENABLE_ARCHIVE_SYNC=true` のときのみ `archive` を取得。
   - 先に health check（`limit=1`）を実施。
   - ページング + limit 縮小リトライで取得。
5. 最後に `public-data/meta.json` を生成。

### `archive` 取得制御（重要）

- `ARCHIVE_PAGE_LIMIT` をページ基本件数として使用。
- `ARCHIVE_LIMITS` は `ARCHIVE_PAGE_LIMIT` 以下の値のみ候補化し、`Argument too large` 時に縮小再試行。
- `offset` は **実際に受け取った件数分** だけ進めるため、limit 縮小時でも無駄な重複取得を抑えます。
- 上限:
  - `ARCHIVE_MAX_PAGES`
  - `ARCHIVE_TOTAL_CAP`

## 4. データ仕様

### 4.1 行データ（songs / gags / archive 共通）

- 元データ想定（A/B/C/D 列）
  - A: `artist`
  - B: `title`
  - C: `kind`
  - D: `dText`
- 補完項目
  - `dUrl`: 任意 URL
  - `date8`: `YYYYMMDD` 数値。優先順は `row.date8` → `dText` 先頭8桁抽出。
  - `rowId`: 既存値優先。無ければ `artist|title|kind|dUrl`（trim + lower）で生成。

### 4.2 生成 JSON

- `songs.json` / `gags.json` / `archive.json`（archive は同期有効時のみ更新）
  - `ok`: `true`
  - `sheet`: タブ名
  - `fetchedAt`: ISO8601
  - `rows`: 正規化済み配列
  - `total`, `matched`: API 値優先、無ければ `rows.length`
- `meta.json`
  - `ok`, `source`, `generatedAt`, `startedAt`
  - `tabs`: 今回出力したタブ
  - `counts`: タブごとの件数

## 5. フロントの読込優先順位

`index.html` は以下を優先して `public-data` を読みます。

1. `?static_base=<URL>` クエリ
2. `localStorage.staticDataBase`
3. 同一オリジン相対パス

整合チェック:

- `meta.tabs` に対象タブがあること
- `meta.counts[tab]` と `rows.length` が一致すること

不一致時は当該静的データを採用せず、動的取得へフォールバックします。

## 6. 環境変数

### 6.1 必須ではないが通常利用するもの

- `GAS_URL`: GAS API URL（未設定時はスクリプト既定値）
- `OUT_DIR`: 出力先（既定 `public-data`）

### 6.2 同期制御

- `SYNC_TIMEOUT_MS`（既定 `8000`）
- `SYNC_MAX_RETRY`（既定 `3`）
- `ENABLE_ARCHIVE_SYNC`（`true` で archive 同期有効）
- `ARCHIVE_STRICT_SYNC`（`true` なら archive 失敗で全体失敗）
- `ARCHIVE_PAGE_LIMIT`（既定 `5`）
- `ARCHIVE_LIMITS`（既定 `20,10,5,3,1`）
- `ARCHIVE_MAX_PAGES`（既定 `4000`）
- `ARCHIVE_TOTAL_CAP`（既定 `20000`）

## 7. 実行方法

```bash
node scripts/sync-gas.mjs
```

成功時は `public-data/*.json` が更新され、`sync complete` ログが出力されます。

## 8. 運用メモ

- `archive` は可変・高負荷になりやすいため、通常は静的配信から分離して運用。
- `public-data` はキャッシュとして扱い、取得失敗時は前回成功分を保持。
- 仕様変更時は `README` と `docs/repository-specification.md` を同時更新すること。

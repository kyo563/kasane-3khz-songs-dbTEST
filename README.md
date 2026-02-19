# kasane-3khz-songs-db

このリポジトリは、Cloudflare R2 から配信する静的JSONを唯一のデータソースとして利用する構成です。

## 構成

1. `scripts/sync-gas.mjs` が GAS API から `songs/gags/archive` を取得（`archive` は小さな `limit` と `offset` ページングで安全に同期）
2. `public-data/*.json` にスナップショットを保存
3. GitHub Actions (`.github/workflows/sync-gas.yml`) が 15分ごとに同期（`archive` も含む）
4. `index.html` は `public-data/*.json`（または `static_base` で指定したR2配信先）からのみ取得

## セットアップ

- 必要に応じて GitHub repository secret `GAS_URL` を設定してください。
  - 未設定時は `scripts/sync-gas.mjs` 内の既定URLを使用します。

## 補足

- `google-apps-script-reference/code.gs` は参照用で、運用ルールとして変更しません。
- `public-data` は静的配信用のキャッシュであり、取得失敗時は前回成功時のデータが残ります。
- `archive` は `limit` 縮小リトライ（`ARCHIVE_LIMITS`）と `offset` ページング（`ARCHIVE_PAGE_LIMIT`）で安全に同期します。
- 取得件数の暴走を防ぐため `ARCHIVE_TOTAL_CAP`（既定: 20000）で上限を設けています。


## トラブルシュート（R2静的配信）

- `index.html` は `songs.json` / `gags.json` / `archive.json` / `meta.json` の4ファイルを前提に読み込みます。
- `meta.json` の `counts` と各JSONの件数が一致しない場合、読み込みを失敗として扱います。
- 配信先を切り替える場合は `?static_base=<URL>` か `localStorage.staticDataBase` を使用してください。

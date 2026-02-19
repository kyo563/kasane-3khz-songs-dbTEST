# kasane-3khz-songs-db

このリポジトリは、Google Apps Script (GAS) の既存API仕様を維持したまま、
GitHub経由のデータ配信を優先することで表示の安定性を高める構成です。

## 構成

1. `scripts/sync-gas.mjs` が GAS API から `songs/gags/archive` を取得
2. `public-data/*.json` にスナップショットを保存
3. GitHub Actions (`.github/workflows/sync-gas.yml`) が 15分ごとに同期
4. `index.html` は `public-data/*.json` を優先取得し、失敗時に従来のGAS取得へフォールバック

## セットアップ

- 必要に応じて GitHub repository secret `GAS_URL` を設定してください。
  - 未設定時は `scripts/sync-gas.mjs` 内の既定URLを使用します。

## 補足

- `google-apps-script-reference/code.gs` は参照用で、運用ルールとして変更しません。
- `public-data` は静的配信用のキャッシュであり、取得失敗時は前回成功時のデータが残ります。
- `archive` は GAS 側のレスポンスサイズ超過（`Exception: 引数が大きすぎます: value`）を避けるため、取得件数上限を小さめに固定しています。

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

## JSONP取得の厳密要件（ブラウザフォールバック時）

`index.html` の JSONP フォールバックは、次の要件を満たす場合のみ実行されます。

1. URL は `https://script.google.com/macros/s/{SCRIPT_ID}/exec` 形式のみ
2. callback 名は英数字/`_`/`$` で構成し、先頭は英字/`_`/`$`、最大96文字
3. クエリ `callback/sheet/authuser/v` を必須化し、`authuser=0` を固定
4. `<script>` 読込は `onerror` + timeout 監視、callback の多重実行を禁止
5. payload が `ok=false` または `error/err` を返した場合は失敗扱いで再試行

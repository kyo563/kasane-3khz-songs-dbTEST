# kasane-3khz-songs-db

このリポジトリは、Cloudflare R2 から配信する静的JSONを唯一のデータソースとして利用する構成です。

## 構成

1. `scripts/sync-gas.mjs` が GAS API から `songs/gags` を取得（`archive` はフロント側で必要時にJSONP直接取得）
2. `public-data/*.json` にスナップショットを保存
3. GitHub Actions (`.github/workflows/sync-gas.yml`) が 15分ごとに同期（songs/gags のみ）
4. `index.html` は `songs/gags` を `public-data/*.json`（または `static_base` で指定したR2配信先）から取得し、`archive` は履歴表示時にGASから直接取得

## セットアップ

- 必要に応じて GitHub repository secret `GAS_URL` を設定してください。
  - 未設定時は `scripts/sync-gas.mjs` 内の既定URLを使用します。

## 返却仕様（songs / gags / archive 共通）

- スプレッドシートの A/B/C/D 列を以下として取り込みます。
  - A列: `artist`
  - B列: `title`
  - C列: `kind`
  - D列: `dText`
- D列の先頭8桁 (`YYYYMMDD`) を `date8` として保持します。
- `rowId` は `artist|title|kind|dUrl` を連結した識別子です。
  - 同一曲（歌手名 + 楽曲名一致）の複数履歴を URL 差分まで含めて識別できます。
- 履歴表示は `date8` 優先で新しい順に並べます。
- `archive` 直接取得時は `exact=1` と小さめ `limit` を優先し、通信量を抑えます。
- 履歴（archive）は `index.html` から GAS の JSONP を直接呼び出して都度取得します。

## 補足

- `google-apps-script-reference/code.gs` は参照用で、運用ルールとして変更しません。
- `public-data` は静的配信用のキャッシュであり、取得失敗時は前回成功時のデータが残ります。
- `archive` は `limit` 縮小リトライ（既定: `20,10,5,3,1`）と `offset` ページング（既定: `ARCHIVE_PAGE_LIMIT=5`）で安全に同期します。
- 取得件数の暴走を防ぐため `ARCHIVE_TOTAL_CAP`（既定: 20000）で上限を設けています。


## トラブルシュート（R2静的配信）

- `index.html` は `songs.json` / `gags.json` / `meta.json` の3ファイルをR2静的データとして読み込みます。
- `meta.json` の `counts.songs` / `counts.gags` と各JSONの件数が一致しない場合、読み込みを失敗として扱います。
- 配信先を切り替える場合は `?static_base=<URL>` か `localStorage.staticDataBase` を使用してください。

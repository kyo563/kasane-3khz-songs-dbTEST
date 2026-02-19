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

## 外部ストレージ連携（Cloudflare R2）

- 「GASデータを独立ストレージへ定期同期する」最小手順は `docs/cloudflare-r2-setup.md` を参照してください。
- 既存の `scripts/sync-gas.mjs` と `.github/workflows/sync-gas.yml` を前提に、追記で導入できる構成です。

## 補足

- `google-apps-script-reference/code.gs` は参照用で、運用ルールとして変更しません。
- `public-data` は静的配信用のキャッシュであり、取得失敗時は前回成功時のデータが残ります。
- `archive` は GAS 側のレスポンスサイズ超過（`Exception: 引数が大きすぎます: value`）を避けるため、取得件数上限を小さめに固定し、失敗時はさらに小さい `limit` へ自動バックオフします。


## トラブルシュート: `archive/fetch(stage)` が `引数が大きすぎます: value` で失敗する理由

このエラーは、GAS 側で巨大な文字列を扱ったとき（レスポンス生成・キャッシュ保存・内部引数処理など）に発生します。つまり「件数」だけでなく「1行あたりの文字量」にも左右されるため、`limit` を下げても特定データで再発することがあります。`google-apps-script-reference/code.gs` では `CACHE_MAX_BYTES` でキャッシュ肥大化を避けていますが、本番デプロイとの差分やデータ偏りがあるとエラーが出ます。

### サーバーから確実にデータ取得する実践策

1. **`archive` は小さめ `limit` で段階取得する**
   - 例: `limit=50` → `limit=120` の2段階で取得し、件数が `limit` 未満になったら打ち切る。
   - 既存フロント (`index.html`) と同期スクリプト (`scripts/sync-gas.mjs`) もこの方針。

2. **失敗時は `limit` を段階的に自動縮小する**
   - フロント (`index.html`) は `120 → 80 → 50 → 30 → 20 → 10` の順に再試行し、`引数が大きすぎます` の場合だけ縮小リトライします。
3. **検索時は必ず `q` を使って対象を絞る**
   - `sheet=archive&q=<keyword>&limit=50` のように、先に絞り込んでから取得すると失敗率が下がる。
4. **失敗時はデプロイURLへフォールバックする**
   - 現行フロント実装のように「通常URL失敗 → deploy URL再試行」にすると、取得元差異に強くなる。
5. **静的スナップショットを第一優先にする**
   - `public-data/archive.json` を優先し、GAS はフォールバックにするとユーザー体感の失敗が激減する。

### サーバー側にデータが入っているか確認する方法

1. **件数チェック（最小確認）**
   - `?sheet=archive&limit=1` を叩き、`ok=true` / `total` / `matched` / `rows[0]` が返るか確認。
2. **上限を変えて増分確認**
   - `limit=10`, `50`, `120` を順に実行し、`rows.length` が期待どおり増えるかを見る。
3. **キーワード確認（実データ存在確認）**
   - スプレッドシートに確実にある曲名の一部で `q` 検索し、`matched > 0` になるか確認。
4. **デバッグ出力確認（リンク抽出含む）**
   - `debug=1` を付けると `dSrc` が返るため、`rich/formula/text` のどこでURLが取れているか検証できる。
5. **運用監視は `public-data/meta.json` と突合**
   - GitHub Actions 同期後の `counts.archive` と API の `total` を比較し、急減や0件化を検知する。

# Cloudflare R2 連携ガイド（無料・最小構成）

このガイドは、既存の `scripts/sync-gas.mjs` を活かしながら、
**GAS -> GitHub Actions -> Cloudflare R2** へ定期同期する手順です。

## 0. 先に決めること（3つだけ）

1. R2 バケット名（例: `kasane-3khz-data`）
2. 公開ドメイン（例: `data.example.com`）
3. 同期間隔（例: 15分）

## 1. Cloudflare 側の準備

1. Cloudflare ダッシュボードで **R2 バケット**を作成する。
2. バケットの **S3 API トークン**を作成する（Write 権限）。
3. 次の値を控える。
   - `account_id`
   - `access_key_id`
   - `secret_access_key`
   - バケット名
4. バケットを公開配信したい場合は、
   - R2 の Public access か
   - Cloudflare CDN 用のカスタムドメイン
   を設定する。

## 2. GitHub Secrets の登録

リポジトリの `Settings > Secrets and variables > Actions` で以下を追加します。

- `GAS_URL`（既存運用と同じ）
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

## 3. Actions から R2 にアップロードする

既存の `.github/workflows/sync-gas.yml` はそのまま使い、
「GAS同期後」に R2 アップロードステップを追加します。

### 追加ステップ例（`sync-gas.yml` の `Sync data from GAS` の後）

```yaml
      - name: Install AWS CLI
        run: |
          sudo apt-get update
          sudo apt-get install -y awscli

      - name: Upload snapshots to R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: |
          aws s3 cp public-data/songs.json s3://$R2_BUCKET/songs.json \
            --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
            --content-type application/json \
            --cache-control "public, max-age=60"

          aws s3 cp public-data/gags.json s3://$R2_BUCKET/gags.json \
            --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
            --content-type application/json \
            --cache-control "public, max-age=60"

          aws s3 cp public-data/archive.json s3://$R2_BUCKET/archive.json \
            --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
            --content-type application/json \
            --cache-control "public, max-age=60"

          aws s3 cp public-data/meta.json s3://$R2_BUCKET/meta.json \
            --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
            --content-type application/json \
            --cache-control "public, max-age=60"
```

> ポイント: R2 は S3 互換APIなので、`aws s3 cp` でそのまま扱えます。

## 4. フロントの参照先を切り替える

`index.html` のデータ取得先を、必要に応じて次のどちらかにします。

- 現状維持: `public-data/*.json`（GitHub配信）
- 外部化: `https://<公開ドメイン>/songs.json` など（R2配信）

最初は安全に、
1. GitHubを優先
2. 失敗時にR2
という段階移行がおすすめです。

## 5. 動作確認（最小チェック）

1. Actions の手動実行（`workflow_dispatch`）
2. 成功後、R2上の `meta.json` をブラウザで開く
3. `fetchedAt` が更新されていることを確認
4. フロントを開いて表示が崩れないことを確認

## 6. よくある失敗と対処

- `403 AccessDenied`
  - トークン権限不足か、バケット名の誤り。
- `Could not connect to the endpoint URL`
  - `R2_ACCOUNT_ID` の値誤り。
- JSON は上がるがブラウザで読めない
  - 公開設定（Public access / カスタムドメイン / CORS）を確認。

## 7. まずはこの最小運用で十分

- 同期間隔: 15分
- JSON 4ファイルだけ配信（`songs/gags/archive/meta`）
- `cache-control: max-age=60`

この構成なら、費用を抑えつつ「独立ストレージへの定期同期」が実現できます。

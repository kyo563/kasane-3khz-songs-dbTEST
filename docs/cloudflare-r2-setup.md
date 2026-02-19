# Cloudflare R2 連携セットアップ手順（初心者向け）

このドキュメントは、`sync-r2.yml` ワークフローで `public-data/*.json` を Cloudflare R2 に定期アップロードするための手順です。

## 1. 事前準備

- Cloudflare アカウント作成済み
- R2 バケット作成済み（例: `your-bucket`）
- この GitHub リポジトリへの管理者権限あり

## 2. Cloudflare 側で必要な情報を用意する

### 2-1. R2 API Token（Access Key / Secret Key）を作る

1. Cloudflare Dashboard を開く
2. **R2** に移動
3. **Manage R2 API Tokens**（または同等のメニュー）を開く
4. `Object Read & Write` 相当の権限でトークンを作成
5. 発行された以下を控える
   - `Access Key ID`
   - `Secret Access Key`

> これらは再表示できないことがあるため、その場で安全に保管してください。

### 2-2. R2 Endpoint を確認する

1. R2 の対象バケットを開く
2. S3 API 互換の **Endpoint** を確認
3. 例: `https://<accountid>.r2.cloudflarestorage.com`

### 2-3. バケット名を確認する

- 例: `your-bucket`

## 3. GitHub Secrets を登録する

GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** から、次の5つを登録します。

- `R2_ACCESS_KEY_ID` : Cloudflare の Access Key ID
- `R2_SECRET_ACCESS_KEY` : Cloudflare の Secret Access Key
- `R2_ENDPOINT` : R2 endpoint URL
- `R2_BUCKET` : バケット名
- `GAS_URL` : GAS の JSON 取得 URL

## 4. ワークフローの動作

追加された `.github/workflows/sync-r2.yml` は次を実行します。

- 30分ごと（`*/30 * * * *`）に起動
- `node scripts/sync-gas.mjs` を実行して `public-data/*.json` を生成
- `aws s3 sync` で `public-data` を R2 の `public-data/` プレフィックスへアップロード
- `--delete` により、ローカルで消えたファイルは R2 側でも削除
- `--region auto` を指定（R2 では必須だが実質未使用）

## 5. 最短の動作確認

1. GitHub の **Actions** タブを開く
2. **Sync GAS snapshot to Cloudflare R2** を選ぶ
3. **Run workflow** で手動実行
4. 成功後、Cloudflare Dashboard → R2 → 対象バケット → **Objects** を確認
5. `public-data/...json` が増えていれば OK

### 5-1. HTML 側が R2 を優先参照しているか確認する

`index.html` は `static_base` クエリか `localStorage.staticDataBase` があれば、その URL 配下の `public-data/*.json` を優先して読み込みます。

1. まず R2 の公開 URL を確認（例: `https://pub-xxxx.r2.dev/public-data/`）
2. ブラウザで以下を開く
   - `https://<あなたのHTMLのURL>/?static_base=https://pub-xxxx.r2.dev/public-data/`
3. 画面の「稼働モニター」で `静的データ: OK` になることを確認

> 毎回クエリを付けたくない場合は、開発者ツール Console で次を1回実行します。  
> `localStorage.setItem('staticDataBase', 'https://pub-xxxx.r2.dev/public-data/')`

### 5-2. 公開 URL で CORS が必要なケース

HTML と R2 のドメインが異なる場合、R2 側に CORS 設定が必要です。最低限、以下を許可してください。

- Allowed origins: `https://<あなたのHTMLのドメイン>`
- Allowed methods: `GET`, `HEAD`
- Allowed headers: `*`（または空）

`静的データ: NG` かつブラウザ Console に CORS エラーが出る場合は、この設定不足が原因です。

## 6. （任意）ブラウザ公開 URL が必要な場合

GitHub Actions でアップロードするだけなら不要です。ブラウザで直接見たい場合のみ設定します。

1. バケット → **Settings**
2. **Public Development URL** を **Enable**
3. `allow` して有効化

これで公開 URL からオブジェクトを参照できるようになります。

## 7. よくあるエラー

- `AccessDenied`:
  - API Token 権限不足、またはバケット指定ミスの可能性
- `Could not connect to the endpoint URL`:
  - `R2_ENDPOINT` の値が誤っている可能性
- `GAS_URL` 関連の失敗:
  - GAS 側の公開設定・URL を再確認

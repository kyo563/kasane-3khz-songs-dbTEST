# Google Apps Script 参照用

このフォルダは、現行の `code.gs` の参照用ドキュメントです。

## 取り込み元シートと列マッピング
- 対象シート名
  - `songs` → `歌った曲リスト`
  - `gags` → `企画/一発ネタシリーズ`
  - `archive` → `アーカイブ`
- 列マッピング（A〜D）
  - A列: 歌手名 → `artist`
  - B列: 楽曲名 → `title`
  - C列: 区分 → `kind`
  - D列: 表示文字列 → `dText`
  - D列のリンクURL（リッチテキスト/式/本文URL抽出）→ `dUrl`
  - D列表示文字列の先頭8文字（`yyyymmdd`）→ `date8`

## APIの返却形
`GET /exec?sheet=songs|gags|archive[&q=...&artist=...&title=...&exact=1&limit=...&offset=...]`

返却例:

```json
{
  "ok": true,
  "sheet": "archive",
  "total": 1234,
  "matched": 5,
  "offset": 0,
  "limit": 40,
  "rows": [
    {
      "artist": "Oasis",
      "title": "Wonderwall",
      "kind": "歌枠",
      "dText": "20260217 ...",
      "dUrl": "https://www.youtube.com/...",
      "date8": 20260217,
      "rowId": "oasis|wonderwall|歌枠|https://www.youtube.com/..."
    }
  ]
}
```

## 履歴ページでの同一曲判定
- 判定条件は **歌手名 + 楽曲名の完全一致** です。
- `archive` は `artist` + `title` + `exact=1` で直接取得します。
- `songs/gags` と `archive` を統合し、`date8` 降順で表示します。

## 通信量を抑える設計
- 履歴ボタン押下時は `archive` 全件取得ではなく、対象曲のみを `exact=1` で取得。
- 同一楽曲の複数履歴は `rowId`（実質 `dUrl` 含む）で重複排除して扱います。

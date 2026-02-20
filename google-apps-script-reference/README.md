# Google Apps Script 参照用

このフォルダは、現行の `code.gs` を**参照するためだけ**に保持します。

- 元スクリプト: `code.gs`
- 返却行: `artist / title / kind / dText / dUrl / date8 / rowId`
- `date8`: D列先頭8文字 (`YYYYMMDD`) の投稿日
- `rowId`: `artist|title|kind|dUrl`（同一曲の複数履歴を URL 差分込みで識別）
- 検索: `exact=1` 指定時は `artist/title` 完全一致を優先

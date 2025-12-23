# 開発ルール（文字化け防止）

- ファイルの文字コードは **UTF-8（BOMなし）** で統一します。Shift_JIS など他のエンコーディングは使用しません。
- 改行コードは LF で統一します（`.editorconfig` で設定済み）。Windows 環境の場合も LF で保存してください。
- エディタ/IDE は保存時のエンコーディングを UTF-8、改行を LF に設定してください。
- Git のローカル設定例：
  - `git config --local core.autocrlf input`（コミット時に CRLF を LF に変換）
  - `git config --local core.eol lf`
- 外部から取り込むスクリプトやドキュメントも、コミット前に UTF-8/LF に変換してください。
- 文字化けを見つけたら、元のエンコーディングを確認した上で UTF-8（BOMなし）に再保存してからコミットしてください。

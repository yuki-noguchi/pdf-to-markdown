# pdf2md (PDF → Markdown via Codex)

PDF を **ページごとに画像化**し、各ページを **OpenAI Codex CLI** に精読させて **Markdown に変換**するローカル向け CLI ツールです。
すべて **Docker コンテナ内で完結**し、ホストに Python や Node.js をインストールする必要はありません。



## 特徴

* PDF → 画像変換は **PyMuPDF**（外部ネイティブツール不要）
* Markdown 生成は **Codex CLI**
* **1 コマンドで実行**
* Codex 認証は **コンテナ起動時にブラウザログイン**
* 認証情報は **Docker Volume に永続化**
* UI / サーバー / DB 不要（完全 CLI）



## 全体構成

```
PDF
 ↓
[ PyMuPDF ]
PDF → page-001.png, page-002.png, ...
 ↓
[ Codex CLI ]
各ページ画像を精読 → page-001.md, ...
 ↓
[ Shell ]
Markdown を結合 → result.md
```

すべて **1 コンテナ内で直列実行**されます。



## 必要なもの

* Docker
* Web ブラウザ（Codex ログイン用）

※ ホスト側に Python / Node / Codex のインストールは不要



## ファイル構成

```
.
├── Dockerfile
├── entrypoint.sh      # Codex ログイン判定 & 初期化
├── run.sh             # PDF→PNG→Codex→Markdown の直列処理
├── pdf2png.py         # PyMuPDF による PDF → PNG
├── .dockerignore
└── input.pdf          # 処理対象の PDF（任意の場所でOK）
```



## セットアップ

### 1. Docker イメージをビルド

```bash
docker build -t pdf2md .
```



## 使い方

### 初回実行（Codex ログインあり）

```bash
docker run --rm -it \
  -v codex-auth:/root/.codex \
  -v "$PWD:/work" -w /work \
  pdf2md input.pdf out
```

* 初回は `codex login` が自動で実行されます
* 表示された URL を **ブラウザで開いて認証**
* 認証情報は `codex-auth` Docker Volume に保存されます



### 2回目以降（ログイン不要）

```bash
docker run --rm \
  -v codex-auth:/root/.codex \
  -v "$PWD:/work" -w /work \
  pdf2md input.pdf out
```



## 出力結果

```
out/
├── pages/
│   ├── page-001.png
│   ├── page-002.png
│   └── ...
├── md/
│   ├── page-001.md
│   ├── page-002.md
│   └── ...
└── result.md          # 統合された Markdown
```



## 処理内容の詳細

### 1. PDF → 画像変換

* PyMuPDF を使用
* DPI デフォルト：250
* ページごとに `page-XXX.png` を生成

### 2. Codex による精読

* 各ページ画像を `codex exec --image` で処理
* 指示内容：

  * Markdown のみを出力
  * 見出し・表・箇条書きを保持
  * 判読不能箇所は `[UNREADABLE]`
  * ページ番号コメントを付与

### 3. Markdown 結合

* ページごとに `` 区切り
* `result.md` に統合



## よくあるトラブル

### ❓ `401 Unauthorized: Missing bearer authentication`

* 認証情報が正しく保存されていない状態です
* 以下を実行してリセットしてください：

```bash
docker volume rm codex-auth
docker build --no-cache -t pdf2md .
```

その後、再度初回実行を行ってください。



## 向いている用途

* 技術資料 / 仕様書 / 論文の Markdown 化
* PDF ベースのドキュメントを AI に精読させたい場合
* UI やサーバーを立てたくないローカル用途



## 注意事項

* Codex CLI は **オンライン接続が必要**
* 完全自動化（CI）用途には向きません（ブラウザ認証が必要なため）
* PDF の内容・レイアウトによって精度は変わります



## ライセンス / 免責

* 本ツールは個人利用・検証用途を想定しています
* Codex / OpenAI API の利用条件に従って使用してください

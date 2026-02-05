# PDF to Markdown (pdf.js + Canvas + Codex CLI)

## 概要

- フロントエンド（React）が `pdfjs-dist` + Canvas で PDF をページ画像化。
- ページ画像を API に逐次アップロード。
- API はジョブと進捗を SQLite で管理し、SSE を配信。
- Worker が `codex exec -i page.png` をページ単位で実行し Markdown 化。
- 最終的に `data/results/{jobId}/result.md` を統合生成。

## ディレクトリ構成

```txt
apps/web
services/api
services/worker
packages/shared
data/
```

## セットアップ

```bash
npm install
```

## 起動

別ターミナルで以下を同時起動（または `npm run dev`）:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## フロー

1. PDF 選択 → `POST /jobs`
2. ブラウザでページ画像化 → `POST /jobs/:jobId/pages`
3. 送信完了 → `POST /jobs/:jobId/complete`
4. Worker がキューを処理
5. 進捗を `GET /jobs/:jobId/events` (SSE) で受信
6. 完了時に Markdown 表示

## 注意

- Worker はローカルの `codex` コマンドが利用可能であることを前提にしています。
- 画像・PDFの中身をログに出力しない設計です。
- Codex 実行は `data/results/{jobId}` 配下で行います。

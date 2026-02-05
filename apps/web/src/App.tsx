import { useMemo, useState } from "react";
import { renderPdfToImages } from "./pdf";

type Phase = "idle" | "uploading" | "queued" | "running" | "done" | "failed";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [markdown, setMarkdown] = useState("");

  const pct = useMemo(() => Math.round(progress * 100), [progress]);

  async function handleUpload(file: File) {
    setPhase("uploading");
    setProgress(0);
    setMarkdown("");

    const form = new FormData();
    form.append("pdf", file);
    const createRes = await fetch(`${API_BASE}/jobs`, { method: "POST", body: form });
    if (!createRes.ok) {
      setPhase("failed");
      setMessage("ジョブの作成に失敗しました");
      return;
    }

    const { jobId } = await createRes.json();
    const source = new EventSource(`${API_BASE}/jobs/${jobId}/events`);

    source.addEventListener("progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { progress: number; message: string };
      setPhase("running");
      setProgress(data.progress);
      setMessage(data.message);
    });

    source.addEventListener("done", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { resultMarkdown: string };
      setPhase("done");
      setProgress(1);
      setMessage("完了しました");
      setMarkdown(data.resultMarkdown);
      source.close();
    });

    source.addEventListener("failed", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { message: string };
      setPhase("failed");
      setMessage(data.message);
      source.close();
    });

    await renderPdfToImages(file, async (page, blob) => {
      const pageForm = new FormData();
      pageForm.append("image", blob, `page-${page}.png`);
      pageForm.append("page", String(page));
      await fetch(`${API_BASE}/jobs/${jobId}/pages`, { method: "POST", body: pageForm });
      setMessage(`Uploading page ${page}`);
    });

    await fetch(`${API_BASE}/jobs/${jobId}/complete`, { method: "POST" });
    setPhase("queued");
    setMessage("アップロード完了。解析待ちです。");
  }

  return (
    <main className="container">
      <h1>PDF → Markdown (pdf.js + Codex CLI)</h1>
      <label className="upload">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        <span>PDF を選択</span>
      </label>

      <section className="panel">
        <p>状態: {phase.toUpperCase()}</p>
        <p>{message}</p>
        <div className="bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <small>{pct}%</small>
      </section>

      {phase === "done" && (
        <section className="panel">
          <h2>Result Markdown</h2>
          <pre>{markdown}</pre>
        </section>
      )}
    </main>
  );
}

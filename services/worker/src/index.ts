import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const repoRoot = path.resolve(process.cwd(), "../..");
const dataDir = path.join(repoRoot, "data");
const dbPath = path.join(dataDir, "db.sqlite");
const pagesRoot = path.join(dataDir, "pages");
const resultsRoot = path.join(dataDir, "results");
const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

for (const dir of [resultsRoot]) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  total_pages INTEGER,
  current_page INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  result_path TEXT,
  error_message TEXT
);
`);

type Job = { id: string; total_pages: number };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listPageImages(jobId: string) {
  const dir = path.join(pagesRoot, jobId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort();
}

async function post(pathname: string, body: unknown) {
  await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function codexPrompt(pageNo: number) {
  return `You are given an image file "page.png" representing a single page of a PDF.\n\nTask:\nConvert the content into clean Markdown.\n\nRules:\n- Output ONLY Markdown.\n- Preserve headings and structure.\n- Use tables for tabular data.\n- Use bullet points when appropriate.\n- Do not add explanations.\n- If text is unreadable, mark as [UNREADABLE].\n\nAdd this comment at the top:\n<!-- page: ${pageNo} -->`;
}

function runCodexForPage(workDir: string, pageNo: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("codex", ["exec", "-i", "page.png", codexPrompt(pageNo)], {
      cwd: workDir,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`codex failed(${code}): ${stderr.slice(0, 300)}`));
    });
  });
}

async function processJob(job: Job) {
  const pageFiles = listPageImages(job.id);
  if (pageFiles.length === 0) return;

  await post(`/internal/jobs/${job.id}/status`, { status: "RUNNING", totalPages: pageFiles.length });

  const resultDir = path.join(resultsRoot, job.id);
  fs.mkdirSync(resultDir, { recursive: true });
  const chunks: string[] = ["# Extracted Document", ""]; 

  for (let i = 0; i < pageFiles.length; i++) {
    const pageNo = i + 1;
    const srcImage = path.join(pagesRoot, job.id, pageFiles[i]);
    const workDir = resultDir;
    const workImage = path.join(workDir, "page.png");
    fs.copyFileSync(srcImage, workImage);

    const md = await runCodexForPage(workDir, pageNo);
    const mdFile = path.join(resultDir, `page-${String(pageNo).padStart(3, "0")}.md`);
    fs.writeFileSync(mdFile, md);

    chunks.push("---", "", md, "");

    const progress = pageNo / pageFiles.length;
    await post(`/internal/jobs/${job.id}/status`, { currentPage: pageNo, progress });
    await post(`/internal/jobs/${job.id}/events`, {
      type: "progress",
      currentPage: pageNo,
      progress,
      message: `Analyzing page ${pageNo}/${pageFiles.length}`
    });
  }

  const resultPath = path.join(resultDir, "result.md");
  fs.writeFileSync(resultPath, chunks.join("\n"));

  await post(`/internal/jobs/${job.id}/status`, { status: "DONE", resultPath: "result.md", progress: 1 });
  await post(`/internal/jobs/${job.id}/events`, {
    type: "done",
    resultMarkdown: fs.readFileSync(resultPath, "utf8")
  });
}

async function tick() {
  const job = db.prepare(`SELECT id, total_pages FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1`).get() as Job | undefined;
  if (!job) return;

  try {
    await processJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await post(`/internal/jobs/${job.id}/status`, { status: "FAILED", errorMessage: message });
    await post(`/internal/jobs/${job.id}/events`, { type: "failed", message });
  }
}

async function main() {
  while (true) {
    await tick();
    await sleep(1500);
  }
}

main();

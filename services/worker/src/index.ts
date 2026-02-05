import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
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

function logInfo(message: string, meta?: Record<string, unknown>) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[worker] ${new Date().toISOString()} ${message}${suffix}`);
}

function logWarn(message: string, meta?: Record<string, unknown>) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.warn(`[worker] ${new Date().toISOString()} ${message}${suffix}`);
}

function logError(message: string, meta?: Record<string, unknown>) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.error(`[worker] ${new Date().toISOString()} ${message}${suffix}`);
}
type JobPatch = Partial<{
  status: "UPLOADING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  totalPages: number;
  currentPage: number;
  progress: number;
  resultPath: string;
  errorMessage: string;
}>;

function updateJobInDb(jobId: string, patch: JobPatch) {
  const mapping: Record<string, string> = {
    status: "status",
    totalPages: "total_pages",
    currentPage: "current_page",
    progress: "progress",
    resultPath: "result_path",
    errorMessage: "error_message"
  };

  const keys = Object.keys(patch) as (keyof JobPatch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${mapping[k]} = ?`);
  const values = keys.map((k) => patch[k]);
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(jobId);

  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listPageImages(jobId: string) {
  const dir = path.join(pagesRoot, jobId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort();
  logInfo("discovered page images", { jobId, count: files.length, files });
  return files;
}

async function post(pathname: string, body: unknown, throwOnError = false) {
  try {
    const res = await fetch(`${apiBase}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const message = `worker->api post failed: ${pathname} status=${res.status}`;
      if (throwOnError) throw new Error(message);
      logWarn(message, { pathname });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (throwOnError) throw error;
    logWarn("worker->api post error", { pathname, message });
  }
}


async function isApiReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(`${apiBase}/healthz`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function codexPrompt(pageNo: number) {
  return `You are given an image file "page.png" representing a single page of a PDF.\n\nTask:\nConvert the content into clean Markdown.\n\nRules:\n- Output ONLY Markdown.\n- Preserve headings and structure.\n- Use tables for tabular data.\n- Use bullet points when appropriate.\n- Do not add explanations.\n- If text is unreadable, mark as [UNREADABLE].\n\nAdd this comment at the top:\n<!-- page: ${pageNo} -->`;
}

function runCodexForPage(workDir: string, pageNo: number) {
  return new Promise<string>((resolve, reject) => {
    const args = ["exec", "-i", "page.png", codexPrompt(pageNo)];
    logInfo("starting codex exec", { pageNo, workDir, argsPreview: ["exec", "-i", "page.png", "<prompt>"] });
    const child = spawn("codex", args, {
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
      if (code === 0) {
        logInfo("codex exec finished", { pageNo, code, stdoutLength: stdout.length, stderrLength: stderr.length });
        resolve(stdout.trim());
      } else {
        logError("codex exec failed", { pageNo, code, stderrPreview: stderr.slice(0, 300) });
        reject(new Error(`codex failed(${code}): ${stderr.slice(0, 300)}`));
      }
    });
  });
}

async function processJob(job: Job) {
  logInfo("start processing job", { jobId: job.id });
  const pageFiles = listPageImages(job.id);
  if (pageFiles.length === 0) {
    logWarn("no page images found for queued job", { jobId: job.id });
    return;
  }

  updateJobInDb(job.id, { status: "RUNNING", totalPages: pageFiles.length });
  await post(`/internal/jobs/${job.id}/status`, { status: "RUNNING", totalPages: pageFiles.length });

  const resultDir = path.join(resultsRoot, job.id);
  fs.mkdirSync(resultDir, { recursive: true });
  logInfo("prepared result directory", { jobId: job.id, resultDir });
  const chunks: string[] = ["# Extracted Document", ""]; 

  for (let i = 0; i < pageFiles.length; i++) {
    const pageNo = i + 1;
    const srcImage = path.join(pagesRoot, job.id, pageFiles[i]);
    logInfo("processing page", { jobId: job.id, pageNo, srcImage });
    const workDir = resultDir;
    const workImage = path.join(workDir, "page.png");
    fs.copyFileSync(srcImage, workImage);

    const md = await runCodexForPage(workDir, pageNo);
    const mdFile = path.join(resultDir, `page-${String(pageNo).padStart(3, "0")}.md`);
    fs.writeFileSync(mdFile, md);

    chunks.push("---", "", md, "");

    const progress = pageNo / pageFiles.length;
    updateJobInDb(job.id, { currentPage: pageNo, progress });
    await post(`/internal/jobs/${job.id}/status`, { currentPage: pageNo, progress });
    await post(`/internal/jobs/${job.id}/events`, {
      type: "progress",
      currentPage: pageNo,
      progress,
      message: `Analyzing page ${pageNo}/${pageFiles.length}`
    });

    if (fs.existsSync(workImage)) {
      fs.unlinkSync(workImage);
      logInfo("removed temp work image", { jobId: job.id, pageNo, workImage });
    }
  }

  const resultPath = path.join(resultDir, "result.md");
  fs.writeFileSync(resultPath, chunks.join("\n"));
  logInfo("wrote merged markdown", { jobId: job.id, resultPath });

  updateJobInDb(job.id, { status: "DONE", resultPath: "result.md", progress: 1 });
  await post(`/internal/jobs/${job.id}/status`, { status: "DONE", resultPath: "result.md", progress: 1 });
  await post(`/internal/jobs/${job.id}/events`, {
    type: "done",
    resultMarkdown: fs.readFileSync(resultPath, "utf8")
  });
  logInfo("finished job", { jobId: job.id });
}

let warnedApiUnavailable = false;

async function tick() {
  if (!(await isApiReady())) {
    if (!warnedApiUnavailable) {
      logWarn("API not reachable; waiting", { apiBase });
      warnedApiUnavailable = true;
    }
    return;
  }

  if (warnedApiUnavailable) {
    logInfo("API reachable; resuming queue processing", { apiBase });
    warnedApiUnavailable = false;
  }

  const job = db.prepare(`SELECT id, total_pages FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1`).get() as Job | undefined;
  if (!job) {
    logInfo("no queued jobs");
    return;
  }
  logInfo("picked queued job", { jobId: job.id, totalPages: job.total_pages ?? null });

  try {
    await processJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("job processing failed", { jobId: job.id, message });
    updateJobInDb(job.id, { status: "FAILED", errorMessage: message });
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

logInfo("worker starting", { apiBase, dbPath, pagesRoot, resultsRoot });
main();

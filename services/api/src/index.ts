import cors from "cors";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { insertJob, updateJob, getJob } from "./db.js";
import { safeJobPath, uploadsDir, pagesDir, resultsDir } from "./paths.js";
import type { JobEvent } from "@pdf2md/shared";

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const pageUpload = multer({ storage: multer.memoryStorage() });

const sseClients = new Map<string, Set<express.Response>>();

function broadcast(jobId: string, event: JobEvent) {
  const clients = sseClients.get(jobId);
  if (!clients) return;
  for (const client of clients) {
    client.write(`event: ${event.type}\n`);
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

app.post("/jobs", upload.single("pdf"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: "PDF is required" });
  const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  if (!isPdf) return res.status(400).json({ message: "Invalid file type" });

  const id = uuidv4();
  const uploadPath = path.join(uploadsDir, `${id}.pdf`);
  fs.writeFileSync(uploadPath, file.buffer);
  insertJob({ id, originalFileName: file.originalname });

  res.json({ jobId: id });
});

app.post("/jobs/:jobId/pages", pageUpload.single("image"), (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ message: "job not found" });

  const pageRaw = String(req.body.page ?? "");
  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" });

  const file = req.file;
  if (!file || file.mimetype !== "image/png") {
    return res.status(400).json({ message: "image/png required" });
  }

  const dir = safeJobPath(pagesDir, jobId);
  const pageName = `page-${String(page).padStart(3, "0")}.png`;
  fs.writeFileSync(path.join(dir, pageName), file.buffer);

  if (!job.totalPages || page > job.totalPages) {
    updateJob(jobId, { totalPages: page });
  }
  res.json({ ok: true });
});

app.post("/jobs/:jobId/complete", (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ message: "job not found" });
  updateJob(jobId, { status: "QUEUED" });
  res.json({ ok: true });
});

app.get("/jobs/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const set = sseClients.get(jobId) ?? new Set();
  set.add(res);
  sseClients.set(jobId, set);

  req.on("close", () => {
    set.delete(res);
  });
});

app.post("/internal/jobs/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  const event = req.body as JobEvent;
  broadcast(jobId, event);
  res.json({ ok: true });
});

app.post("/internal/jobs/:jobId/status", (req, res) => {
  const { jobId } = req.params;
  updateJob(jobId, req.body);
  res.json({ ok: true });
});

app.get("/jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: "job not found" });
  let markdown = "";
  if (job.resultPath) {
    const full = path.join(resultsDir, job.id, job.resultPath);
    if (fs.existsSync(full)) markdown = fs.readFileSync(full, "utf8");
  }
  res.json({ ...job, markdown });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

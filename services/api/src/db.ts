import Database from "better-sqlite3";
import { dbPath } from "./paths.js";
import type { JobRecord, JobStatus } from "@pdf2md/shared";

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

export function insertJob(input: { id: string; originalFileName: string }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, status, created_at, updated_at, original_file_name) VALUES (?, 'UPLOADING', ?, ?, ?)`
  ).run(input.id, now, now, input.originalFileName);
}

export function updateJob(jobId: string, patch: Partial<{ status: JobStatus; totalPages: number; currentPage: number; progress: number; resultPath: string; errorMessage: string }>) {
  const mapping: Record<string, string> = {
    status: "status",
    totalPages: "total_pages",
    currentPage: "current_page",
    progress: "progress",
    resultPath: "result_path",
    errorMessage: "error_message"
  };
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;

  const sets = keys.map((k) => `${mapping[k as string]} = ?`);
  const values = keys.map((k) => patch[k]);
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(jobId);

  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getJob(jobId: string): JobRecord | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as any;
  if (!row) return null;
  return mapJob(row);
}

function mapJob(row: any): JobRecord {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originalFileName: row.original_file_name,
    totalPages: row.total_pages,
    currentPage: row.current_page,
    progress: row.progress,
    resultPath: row.result_path,
    errorMessage: row.error_message
  };
}

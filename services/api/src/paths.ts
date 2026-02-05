import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
export const dataDir = path.join(repoRoot, "data");
export const uploadsDir = path.join(dataDir, "uploads");
export const pagesDir = path.join(dataDir, "pages");
export const resultsDir = path.join(dataDir, "results");
export const dbPath = path.join(dataDir, "db.sqlite");

for (const dir of [dataDir, uploadsDir, pagesDir, resultsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeJobPath(baseDir: string, jobId: string) {
  const safe = jobId.replace(/[^a-zA-Z0-9-_]/g, "");
  const fullPath = path.join(baseDir, safe);
  fs.mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

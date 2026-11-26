import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.ts";

export type ArrangeStatus = "pending" | "running" | "done" | "error";
export type ArrangeGroupResult = { index: number; colors: string[]; parts: number; plates: number; gramsPerPlate: number[]; minutesPerPlate: number[] };
export type ArrangeJobResult = { groups: ArrangeGroupResult[]; totalPlates: number; originalPlates: number; spoolChanges: number; keptParts: number; originalParts: number };
export type ArrangeJob = { id: string; createdAt: string; status: ArrangeStatus; progress: number; error: string | null; result: ArrangeJobResult | null };
const ROOT = path.join(DATA_DIR, "arrange");
const registry = ((globalThis as { __arrangeJobs?: Map<string, ArrangeJob> }).__arrangeJobs ??= new Map());
const jobPath = (id: string) => path.join(ROOT, id, "job.json");
function cleanExpired() {
  if (!fs.existsSync(ROOT)) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(ROOT, entry.name);
    try { if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 并发作业可能刚好在写入 */ }
  }
}
export function saveArrangeJob(job: ArrangeJob) { fs.mkdirSync(path.dirname(jobPath(job.id)), { recursive: true }); fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2)); }
export function createArrangeJob() { cleanExpired(); const job: ArrangeJob = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "pending", progress: 0, error: null, result: null }; registry.set(job.id, job); saveArrangeJob(job); return job; }
export function getArrangeJob(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const live = registry.get(id); if (live) return live;
  try { const job = JSON.parse(fs.readFileSync(jobPath(id), "utf8")) as ArrangeJob; registry.set(id, job); return job; } catch { return null; }
}

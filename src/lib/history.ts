import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.ts";
import { resolveSite, type SiteId } from "./sites.ts";

export type HistoryState = "done" | "failed" | "aborted" | "unknown";
export type FailReason = "adhesion" | "stringing" | "clog" | "warp" | "support" | "other";
export type HistoryRecord = {
  id: string;
  at: string;
  designId?: number;
  instanceId?: number;
  modelName?: string;
  site: SiteId;
  plate?: number;
  optionsSummary?: string;
  jobId?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  filamentGrams?: number;
  state: HistoryState;
  failReason?: FailReason | null;
  note?: string;
  supersedes?: string;
};

const filePath = () => path.join(DATA_DIR, "history.jsonl");
const STATES = new Set<HistoryState>(["done", "failed", "aborted", "unknown"]);
const FAIL_REASONS = new Set<FailReason>(["adhesion", "stringing", "clog", "warp", "support", "other"]);

function finiteNumber(value: unknown, integer = false): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return integer ? Math.round(n) : n;
}

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

export type HistoryInput = Omit<HistoryRecord, "id" | "at" | "site"> & { id?: string; at?: string; site?: string };

export function normalizeHistory(input: HistoryInput): HistoryRecord {
  const state = STATES.has(input.state) ? input.state : "unknown";
  const failReason = input.failReason == null ? null : FAIL_REASONS.has(input.failReason) ? input.failReason : "other";
  const id = typeof input.id === "string" && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : crypto.randomUUID();
  const record: HistoryRecord = {
    id,
    at: typeof input.at === "string" && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString(),
    site: resolveSite(input.site),
    state,
    failReason,
  };
  for (const [key, value] of [
    ["designId", finiteNumber(input.designId, true)],
    ["instanceId", finiteNumber(input.instanceId, true)],
    ["plate", finiteNumber(input.plate, true)],
    ["estimatedMinutes", finiteNumber(input.estimatedMinutes)],
    ["actualMinutes", finiteNumber(input.actualMinutes)],
    ["filamentGrams", finiteNumber(input.filamentGrams)],
  ] as const) {
    if (value !== undefined) (record as Record<string, unknown>)[key] = Math.max(0, value);
  }
  const texts: Array<[keyof HistoryRecord, unknown, number]> = [
    ["modelName", input.modelName, 200],
    ["optionsSummary", input.optionsSummary, 300],
    ["jobId", input.jobId, 100],
    ["note", input.note, 1000],
    ["supersedes", input.supersedes, 36],
  ];
  for (const [key, value, max] of texts) {
    const text = cleanText(value, max);
    if (text) (record as Record<string, unknown>)[key] = text;
  }
  return record;
}

function readRaw(): HistoryRecord[] {
  try {
    return fs.readFileSync(filePath(), "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as HistoryInput;
        return [normalizeHistory(parsed)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function append(record: HistoryRecord) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(filePath(), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export function recordHistory(input: HistoryInput): HistoryRecord {
  const record = normalizeHistory(input);
  if (record.instanceId == null && !record.modelName) throw new Error("instanceId or modelName is required");
  append(record);
  return record;
}

/** Returns the newest version of each logical record while retaining append-only storage. */
function currentRows() {
  const raw = readRaw();
  const replaced = new Set<string>();
  for (const row of raw) if (row.supersedes) replaced.add(row.supersedes);
  return raw.filter((row) => !replaced.has(row.id)).sort((a, b) => b.at.localeCompare(a.at));
}

/** Returns the newest version of each logical record while retaining append-only storage. */
export function listHistory(filters: { limit?: number; offset?: number; state?: string; designId?: string } = {}) {
  const filtered = currentRows().filter((row) => {
    if (filters.state && row.state !== filters.state) return false;
    if (filters.designId && String(row.designId ?? "") !== filters.designId) return false;
    return true;
  });
  const offset = Math.max(0, Number(filters.offset) || 0);
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export function updateHistory(id: string, patch: Partial<Pick<HistoryRecord, "state" | "failReason" | "note">>) {
  const rows = readRaw();
  let current = rows.find((row) => row.id === id) ?? null;
  if (!current) return null;
  let changed = true;
  while (changed) {
    changed = false;
    const successor = rows.filter((row) => row.supersedes === current!.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (successor) { current = successor; changed = true; }
  }
  if (!current) return null;
  const next = recordHistory({ ...current, ...patch, id: undefined, supersedes: current.id });
  return next;
}

export function historyStats() {
  const rows = currentRows();
  const done = rows.filter((r) => r.state === "done");
  const totalMinutes = rows.reduce((sum, r) => sum + (r.actualMinutes ?? 0), 0);
  const totalGrams = rows.reduce((sum, r) => sum + (r.filamentGrams ?? 0), 0);
  const byModel = new Map<string, HistoryRecord[]>();
  for (const row of rows) {
    const name = row.modelName || (row.instanceId != null ? String(row.instanceId) : "未知模型");
    byModel.set(name, [...(byModel.get(name) ?? []), row]);
  }
  const models = [...byModel.entries()].map(([modelName, list]) => ({
    modelName,
    count: list.length,
    success: list.filter((r) => r.state === "done").length,
    failed: list.filter((r) => r.state === "failed").length,
    successRate: list.length ? list.filter((r) => r.state === "done").length / list.length : 0,
    averageMinutes: list.length ? list.reduce((s, r) => s + (r.actualMinutes ?? 0), 0) / list.length : 0,
    averageFilamentGrams: list.length ? list.reduce((s, r) => s + (r.filamentGrams ?? 0), 0) / list.length : 0,
  })).sort((a, b) => b.count - a.count);
  const failures: Record<string, number> = {};
  for (const row of rows.filter((r) => r.state === "failed")) {
    const key = row.failReason ?? "other";
    failures[key] = (failures[key] ?? 0) + 1;
  }
  return {
    total: rows.length,
    successRate: rows.length ? done.length / rows.length : 0,
    totalFilamentGrams: totalGrams,
    totalMinutes,
    averageMinutes: rows.length ? totalMinutes / rows.length : 0,
    models,
    failures,
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportHistoryCsv() {
  const rows = currentRows();
  const headers = ["时间", "模型名", "设计 id", "配置 id", "盘号", "参数", "预计分钟", "实际分钟", "耗材克", "状态", "失败原因", "备注"];
  const lines = [headers, ...rows.map((r) => [r.at, r.modelName ?? "", r.designId ?? "", r.instanceId ?? "", r.plate ?? "", r.optionsSummary ?? "", r.estimatedMinutes ?? "", r.actualMinutes ?? "", r.filamentGrams ?? "", r.state, r.failReason ?? "", r.note ?? ""])].map((line) => line.map(csvCell).join(","));
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  try {
    const dir = "/mnt/smb/u1-history";
    fs.mkdirSync(dir, { recursive: true });
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(path.join(dir, `${month}.csv`), csv);
  } catch (err) {
    console.warn("Unable to write history export to /mnt/smb", err instanceof Error ? err.message : String(err));
  }
  return csv;
}

/** Persists one record when Moonraker reports that a print has ended. */
export function observePrinterStatus(status: { state?: string; filename?: string; printSeconds?: number }) {
  const tracker = (globalThis as { __u1HistoryPrinter?: { previous?: string; startedAt?: number; filename?: string } }).__u1HistoryPrinter ??= {};
  const state = String(status.state ?? "unknown").toLowerCase();
  if (state === "printing" && tracker.previous !== "printing") {
    tracker.startedAt = Date.now();
    tracker.filename = status.filename;
  }
  const ended = tracker.previous === "printing" && ["complete", "error", "cancelled", "canceled"].includes(state);
  if (ended) {
    const finalState: HistoryState = state === "complete" ? "done" : state === "cancelled" || state === "canceled" ? "aborted" : "failed";
    const actualMinutes = typeof status.printSeconds === "number" && Number.isFinite(status.printSeconds) ? status.printSeconds / 60 : tracker.startedAt ? (Date.now() - tracker.startedAt) / 60000 : undefined;
    try {
      recordHistory({ modelName: tracker.filename || status.filename || "打印任务", actualMinutes, state: finalState, failReason: finalState === "failed" ? "other" : null });
    } catch (err) {
      console.warn("Unable to record printer history", err instanceof Error ? err.message : String(err));
    }
    tracker.startedAt = undefined;
    tracker.filename = undefined;
  }
  tracker.previous = state;
}

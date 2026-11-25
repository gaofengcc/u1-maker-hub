import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadInstance } from "./makerworld.ts";
import { plateFilaments, readProject } from "./threemf.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, sliceForU1, type PrintMode, type PrintOptions } from "./slicer.ts";
import { DATA_DIR, JOB_DIR, readSettings } from "./store.ts";

/** 修改切片流程后手动递增，避免旧结果继续冒充新逻辑。 */
export const SLICE_CACHE_VERSION = "slice-v1";
const SLICE_CACHE_DIR = path.join(DATA_DIR, "slice-cache");
const SLICE_JOB_DIR = JOB_DIR;
const MAX_RUNTIME_MS = 600_000;

export type SliceTaskState = "pending" | "running" | "done" | "error";
export type SliceTask = {
  id: string;
  createdAt: string;
  status: SliceTaskState;
  progress: number;
  stage: "准备中" | "切片中" | "统计中";
  startedAt: string | null;
  elapsedMs: number;
  instanceId: number;
  file?: string;
  plate: number;
  mode: PrintMode;
  options: PrintOptions;
  overrides: Record<string, string>;
  site?: string;
  result: { minutes: number; grams: number; layers: number } | null;
  cached: boolean;
  sourceKey: string | null;
  error: string | null;
};

type SliceTaskInput = Pick<SliceTask, "instanceId" | "plate" | "mode" | "options" | "overrides" | "site"> & { file?: string };

const registry: Map<string, SliceTask> = ((globalThis as { __u1SliceTasks?: Map<string, SliceTask> }).__u1SliceTasks ??= new Map());
let active = false;
let queue: string[] = [];
let hits = 0;
let misses = 0;

function taskFile(id: string) {
  return path.join(SLICE_JOB_DIR, id, "slice.json");
}

function save(task: SliceTask) {
  fs.mkdirSync(path.dirname(taskFile(task.id)), { recursive: true });
  fs.writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2));
}

export function getSliceTask(id: string): SliceTask | null {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const live = registry.get(id);
  if (live) return live;
  try {
    const task = JSON.parse(fs.readFileSync(taskFile(id), "utf8")) as SliceTask;
    registry.set(id, task);
    return task;
  } catch {
    return null;
  }
}

export function createSliceTask(input: SliceTaskInput): SliceTask {
  const task: SliceTask = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    progress: 0,
    stage: "准备中",
    startedAt: null,
    elapsedMs: 0,
    options: normalizeOptions(input.options),
    overrides: normalizeOverrides(input.overrides),
    result: null,
    cached: false,
    sourceKey: null,
    error: null,
  };
  const localFile = input.file && fs.existsSync(input.file)
    ? input.file
    : input.instanceId > 0
      ? path.join(DATA_DIR, "downloads", input.site ?? "cn", `${input.instanceId}.3mf`)
      : undefined;
  if (localFile && fs.existsSync(localFile)) {
    const key = cacheKey(fs.readFileSync(localFile), task);
    const cached = readCache(key);
    if (cached) {
      hits++;
      task.status = "done";
      task.progress = 100;
      task.stage = "统计中";
      task.elapsedMs = 0;
      task.cached = true;
      task.sourceKey = key;
      task.result = cached;
      save(task);
      return task;
    }
  }
  misses++;
  registry.set(task.id, task);
  save(task);
  queue.push(task.id);
  void pump();
  return task;
}

export function sliceCacheStats() {
  let entries = 0;
  let bytes = 0;
  if (fs.existsSync(SLICE_CACHE_DIR)) {
    for (const name of fs.readdirSync(SLICE_CACHE_DIR)) {
      if (!name.endsWith(".json")) continue;
      entries++;
      try { bytes += fs.statSync(path.join(SLICE_CACHE_DIR, name)).size; } catch { /* 文件可能刚被替换 */ }
    }
  }
  const total = hits + misses;
  return { entries, bytes, hitRate: total ? hits / total : 0 };
}

async function pump() {
  if (active) return;
  active = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const task = getSliceTask(id);
      if (task) await runTask(task);
    }
  } finally {
    active = false;
  }
}

async function runTask(task: SliceTask) {
  const started = Date.now();
  task.status = "running";
  task.startedAt = new Date(started).toISOString();
  task.stage = "准备中";
  save(task);
  try {
    const source = task.file && fs.existsSync(task.file)
      ? { file: task.file }
      : await downloadInstance(task.instanceId, task.site as never);
    const bytes = fs.readFileSync(source.file);
    const sourceKey = cacheKey(bytes, task);
    task.sourceKey = sourceKey;
    const cached = readCache(sourceKey);
    if (cached) {
      hits++;
      task.result = cached;
      task.cached = true;
      task.progress = 100;
      task.stage = "统计中";
      finish(task, started);
      return;
    }
    const info = await readProject(source.file);
    const settings = readSettings();
    const slotCount = Math.max(1, info.filaments.length);
    const mapping = Array.from({ length: slotCount }, (_, i) => i % 4);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "u1-slice-task-"));
    task.stage = "切片中";
    task.progress = 30;
    save(task);
    try {
      const result = await sliceForU1({
        input: source.file,
        workDir,
        mode: task.mode,
        options: task.options,
        overrides: task.overrides,
        tools: settings.tools,
        filamentToTool: mapping,
        filamentTypes: info.filaments.map((f) => f.type),
        plate: task.plate,
        timeoutMs: MAX_RUNTIME_MS,
        onLog: (line) => updateProgress(task, line),
      });
      task.stage = "统计中";
      task.progress = Math.max(task.progress, 80);
      save(task);
      const stats = result.gcodeFiles.map(readGcodeStats);
      const seconds = stats.every((s) => s.seconds != null) ? stats.reduce((n, s) => n + (s.seconds ?? 0), 0) : 0;
      const grams = stats.every((s) => s.grams != null) ? stats.reduce((n, s) => n + (s.grams ?? 0), 0) : 0;
      const layers = stats.reduce((n, s) => n + s.layers, 0);
      const value = { minutes: seconds / 60, grams, layers };
      writeCache(sourceKey, { ...value, createdAt: new Date().toISOString(), sourceKey });
      task.result = value;
      task.progress = 100;
      finish(task, started);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } catch (err) {
    task.status = "error";
    task.error = err instanceof Error ? err.message : String(err);
    task.elapsedMs = Date.now() - started;
    save(task);
  }
}

function finish(task: SliceTask, started: number) {
  task.status = "done";
  task.elapsedMs = Date.now() - started;
  save(task);
}

function updateProgress(task: SliceTask, line: string) {
  const match = /\blayer\s+(\d+)\s*(?:\/|of)\s*(\d+)/i.exec(line);
  if (match) {
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (total > 0 && current >= 0 && current <= total) task.progress = Math.min(80, 30 + Math.round(current / total * 50));
  } else if (/slic|gcode|toolpath/i.test(line)) {
    task.progress = Math.max(task.progress, 30);
  }
  save(task);
}

function cacheKey(bytes: Buffer, task: SliceTask) {
  const fileHash = crypto.createHash("sha1").update(bytes).digest("hex");
  const overrideHash = crypto.createHash("sha1").update(stableStringify({
    plate: task.plate,
    mode: task.mode,
    options: task.options,
    overrides: task.overrides,
  })).digest("hex");
  return `${fileHash}|${overrideHash}|${SLICE_CACHE_VERSION}`;
}

function cacheFile(key: string) {
  return path.join(SLICE_CACHE_DIR, `${key.replaceAll("|", "_")}.json`);
}

function readCache(key: string): { minutes: number; grams: number; layers: number } | null {
  try {
    const value = JSON.parse(fs.readFileSync(cacheFile(key), "utf8")) as { minutes: number; grams: number; layers: number };
    return Number.isFinite(value.minutes) && Number.isFinite(value.grams) ? { minutes: value.minutes, grams: value.grams, layers: Number(value.layers) || 0 } : null;
  } catch { return null; }
}

function writeCache(key: string, value: { minutes: number; grams: number; layers: number; createdAt: string; sourceKey: string }) {
  fs.mkdirSync(SLICE_CACHE_DIR, { recursive: true });
  const temp = `${cacheFile(key)}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, cacheFile(key));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizeOverrides(input: Record<string, string> | undefined) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => /^[a-zA-Z0-9_.-]+$/.test(key) && typeof value === "string").map(([key, value]) => [key, value.slice(0, 200)]));
}

function normalizeOptions(input: Partial<PrintOptions> | undefined): PrintOptions {
  const o = { ...DEFAULT_OPTIONS, ...(input ?? {}) } as PrintOptions;
  return {
    infillDensity: Number.isFinite(Number(o.infillDensity)) ? Number(o.infillDensity) : DEFAULT_OPTIONS.infillDensity,
    infillPattern: ["gyroid", "grid", "crosshatch", "cubic", "lightning", "honeycomb"].includes(o.infillPattern) ? o.infillPattern : DEFAULT_OPTIONS.infillPattern,
    wallLoops: Number.isFinite(Number(o.wallLoops)) ? Number(o.wallLoops) : DEFAULT_OPTIONS.wallLoops,
    supports: ["off", "auto", "plate"].includes(o.supports) ? o.supports : DEFAULT_OPTIONS.supports,
    brim: ["none", "auto", "always"].includes(o.brim) ? o.brim : DEFAULT_OPTIONS.brim,
    ironing: Boolean(o.ironing),
    seam: ["aligned", "back", "nearest", "random"].includes(o.seam) ? o.seam : DEFAULT_OPTIONS.seam,
    layers: ["fixed", "adaptive", "balanced"].includes(o.layers) ? o.layers : DEFAULT_OPTIONS.layers,
    supportAngle: o.supportAngle,
    overhangSpeed: o.overhangSpeed,
  };
}

function readGcodeStats(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const grams = Number(/total filament used \[g\] = ([^\r\n]+)/i.exec(text)?.[1]?.split(",").reduce((n, v) => n + Number(v.trim()), 0));
  const time = /estimated printing time \(normal mode\) = ([^\r\n]+)/i.exec(text)?.[1] ?? "";
  let seconds = 0;
  for (const [, n, unit] of time.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) seconds += Number(n) * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[unit.toLowerCase()];
  return { grams: Number.isFinite(grams) ? grams : null, seconds: time ? seconds : null, layers: (text.match(/^;\s*(?:LAYER_CHANGE|layer num:)/gim) ?? []).length };
}

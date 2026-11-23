import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { JOB_DIR, readSettings } from "./store.ts";
import { downloadInstance, MakerWorldError } from "./makerworld.ts";
import { readProject } from "./threemf.ts";
import { sliceForU1, type PrintMode, type PrintOptions } from "./slicer.ts";
import type { PlateTransform } from "./geometry.ts";
import type { PlateEntry } from "./plate.ts";
import { combineProjects } from "./combine.ts";
import { getStatus, runGcode, safeRemoteName, startPrint, uploadGcode } from "./printer.ts";
import { uploadFilePath, uploadProjectPath, type UploadKind } from "./uploads.ts";

/** A print job: download from MakerWorld (or take an uploaded STL or 3MF), swap in U1 presets, slice, then optionally send to the printer. */

export type StepKey = "download" | "presets" | "slice" | "upload" | "print";
export type StepState = "pending" | "running" | "done" | "error" | "skipped";

export type Job = {
  id: string;
  createdAt: string;
  designId: number;
  instanceId: number;
  title: string;
  cover: string;
  mode: PrintMode;
  options: PrintOptions;
  plate: number;
  /** Size and rotation of the plate; missing on jobs made before resizing existed. */
  transform?: PlateTransform;
  /** Set when several models are printed together on one plate. */
  items?: PlateJobItem[];
  /** Set for a file uploaded by hand; designId and instanceId are then 0. Missing kind means STL. */
  upload?: { id: string; name: string; kind?: UploadKind };
  filamentToTool: number[];
  send: boolean;
  status: "running" | "done" | "error";
  steps: { key: StepKey; label: string; state: StepState; detail: string }[];
  error: string | null;
  errorCode: string | null;
  files: { gcode: string[]; project: string | null };
  remoteName: string | null;
  /** Totals over every U1 plate. */
  stats: JobStats;
  /** Set when the models need several U1 plates: one entry per plate, printed one after the other. */
  plates?: JobPlate[];
  log: string[];
};

/** gramsByFilament: weight of each logical filament of the G-code (T0, T1…); missing on older jobs. */
export type JobStats = { seconds: number | null; grams: number | null; toolChanges: number | null; gramsByFilament?: number[] };
export type JobPlate = { gcode: string; project: string; stats: JobStats; remoteName: string | null };

export type NewJob = Pick<Job, "designId" | "instanceId" | "title" | "cover" | "mode" | "options" | "plate" | "transform" | "items" | "upload" | "filamentToTool" | "send">;

export type PlateJobItem = Pick<
  PlateEntry,
  "designId" | "instanceId" | "uploadId" | "title" | "plate" | "size" | "rotation" | "orient" | "copies" | "bed" | "filamentToTool"
>;

const STEP_LABELS: Record<StepKey, string> = {
  download: "Download 3MF from MakerWorld",
  presets: "Swap in U1 presets",
  slice: "Slice with OrcaSlicer",
  upload: "Upload to the U1",
  print: "Start print",
};

const registry: Map<string, Job> = ((globalThis as { __u1Jobs?: Map<string, Job> }).__u1Jobs ??= new Map());

function jobFile(id: string) {
  return path.join(JOB_DIR, id, "job.json");
}

function save(job: Job) {
  fs.mkdirSync(path.dirname(jobFile(job.id)), { recursive: true });
  fs.writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2));
}

export function getJob(id: string): Job | null {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const live = registry.get(id);
  if (live) return live;
  try {
    return JSON.parse(fs.readFileSync(jobFile(id), "utf8"));
  } catch {
    return null;
  }
}

export function listJobs(limit = 20): Job[] {
  if (!fs.existsSync(JOB_DIR)) return [];
  return fs
    .readdirSync(JOB_DIR)
    .map((id) => getJob(id))
    .filter((j): j is Job => Boolean(j))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function createJob(input: NewJob): Job {
  const job: Job = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "running",
    steps: (["download", "presets", "slice", "upload", "print"] as StepKey[]).map((key) => ({
      key,
      label:
        key !== "download"
          ? STEP_LABELS[key]
          : input.upload
            ? `Read the uploaded ${input.upload.kind === "3mf" ? "3MF" : "STL"}`
            : input.items?.some((i) => i.uploadId)
              ? "Gather the models"
              : STEP_LABELS[key],
      state: !input.send && (key === "upload" || key === "print") ? "skipped" : "pending",
      detail: "",
    })),
    error: null,
    errorCode: null,
    files: { gcode: [], project: null },
    remoteName: null,
    stats: { seconds: null, grams: null, toolChanges: null },
    log: [],
  };
  registry.set(job.id, job);
  save(job);
  void runJob(job);
  return job;
}

/** Sends an already sliced job to the printer: its U1 plate number `plate` (1-based) when it has several. */
export function sendJob(id: string, plate = 1): Job {
  const job = getJob(id);
  if (!job) throw new Error("Job not found.");
  if (!job.files.gcode.length) throw new Error("This job has no G-code yet.");
  if (job.status === "running") throw new Error("This job is still running.");
  const count = job.plates?.length ?? 1;
  if (!Number.isInteger(plate) || plate < 1 || plate > count) throw new Error(`This job has no plate ${plate}.`);
  job.send = true;
  job.status = "running";
  job.error = null;
  for (const s of job.steps) if (s.key === "upload" || s.key === "print") s.state = "pending";
  registry.set(job.id, job);
  save(job);
  void runSend(job, plate);
  return job;
}

function setStep(job: Job, key: StepKey, state: StepState, detail = "") {
  const step = job.steps.find((s) => s.key === key)!;
  step.state = state;
  if (detail) step.detail = detail;
  save(job);
}

function fail(job: Job, err: unknown) {
  const running = job.steps.find((s) => s.state === "running");
  if (running) running.state = "error";
  job.status = "error";
  job.error = err instanceof Error ? err.message : String(err);
  job.errorCode = err instanceof MakerWorldError ? err.code : null;
  save(job);
}

async function runJob(job: Job) {
  const dir = path.join(JOB_DIR, job.id);
  try {
    const settings = readSettings();
    let inputs: string[];
    let mapping: number[];
    if (job.upload?.kind === "3mf") {
      // A project file: handled like a MakerWorld download, with its own filaments and plates.
      setStep(job, "download", "running");
      const file = uploadFilePath(job.upload.id);
      setStep(job, "download", "done", `${job.upload.name}.3mf`);
      setStep(job, "presets", "running");
      const project = await readProject(file);
      const slots = project.filaments.length;
      mapping = Array.from({ length: slots }, (_, i) => clampTool(job.filamentToTool[i] ?? i % 4));
      setStep(job, "presets", "done", `${project.printer || "3MF"} → Snapmaker U1 · ${slots} filament${slots > 1 ? "s" : ""}`);
      inputs = [file];
    } else if (job.upload) {
      // A plain mesh: one filament, already in millimetres. The slicer step places it on the bed.
      setStep(job, "download", "running");
      inputs = [uploadFilePath(job.upload.id)];
      setStep(job, "download", "done", `${job.upload.name}.stl`);
      setStep(job, "presets", "running");
      mapping = [clampTool(job.filamentToTool[0] ?? 0)];
      setStep(job, "presets", "done", "STL → Snapmaker U1 · 1 filament");
    } else if (job.items?.length) {
      // Several models: download each, then merge them into one project per U1 plate where filament N is toolhead N.
      setStep(job, "download", "running");
      const files: string[] = [];
      for (const [i, item] of job.items.entries()) {
        setStep(job, "download", "running", `${i + 1} of ${job.items.length} · ${item.title}`);
        files.push(item.uploadId ? await uploadProjectPath(item.uploadId) : (await downloadInstance(item.instanceId)).file);
      }
      setStep(job, "download", "done", `${files.length} model${files.length > 1 ? "s" : ""}`);

      setStep(job, "presets", "running", "Placing the models on the U1 plates");
      const placed = await combineProjects(
        job.items.map((item, i) => ({
          file: files[i],
          plate: item.plate,
          transform: { scale: item.size / 100, rotation: item.rotation, orient: item.orient },
          copies: item.copies,
          bed: item.bed,
          filamentToTool: item.filamentToTool.map(clampTool),
          title: item.title,
        })),
        path.join(dir, "plates"),
      );
      inputs = placed.files;
      mapping = [0, 1, 2, 3];
      const where = inputs.length > 1 ? `${inputs.length} plates` : "one plate";
      setStep(job, "presets", "done", `${placed.copies} object${placed.copies > 1 ? "s" : ""} on ${where} · T1–T4`);
    } else {
      setStep(job, "download", "running");
      const download = await downloadInstance(job.instanceId);
      setStep(job, "download", "done", download.cached ? "Already downloaded" : download.name);

      setStep(job, "presets", "running");
      const project = await readProject(download.file);
      const slots = project.filaments.length;
      mapping = Array.from({ length: slots }, (_, i) => clampTool(job.filamentToTool[i] ?? i % 4));
      setStep(job, "presets", "done", `${project.printer || "Bambu"} → Snapmaker U1 · ${slots} filament${slots > 1 ? "s" : ""}`);
      inputs = [download.file];
    }
    job.filamentToTool = mapping;

    setStep(job, "slice", "running");
    const onLog = (line: string) => {
      job.log.push(line);
      if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    };
    // One slicer run per U1 plate, one after the other to keep memory use down.
    const plates: JobPlate[] = [];
    const adaptive: NonNullable<Awaited<ReturnType<typeof sliceForU1>>["layers"]>[] = [];
    for (const [i, input] of inputs.entries()) {
      if (inputs.length > 1) setStep(job, "slice", "running", `Plate ${i + 1} of ${inputs.length}`);
      const result = await sliceForU1({
        input,
        workDir: path.join(dir, inputs.length > 1 ? `slice-${i + 1}` : "slice"),
        mode: job.mode,
        options: job.options,
        tools: settings.tools,
        filamentToTool: mapping,
        plate: job.items?.length ? 1 : job.plate,
        transform: job.transform,
        onLog,
      });
      plates.push({ gcode: result.gcodeFiles[0], project: result.exported3mf, stats: readGcodeStats(result.gcodeFiles[0]), remoteName: null });
      if (result.layers) adaptive.push(result.layers);
      if (inputs.length === 1) job.files = { gcode: result.gcodeFiles, project: result.exported3mf };
    }
    if (plates.length > 1) {
      job.plates = plates;
      job.files = { gcode: plates.map((p) => p.gcode), project: plates[0].project };
    }
    job.stats = sumStats(plates.map((p) => p.stats));
    // Adaptive layers are worth a word: the slicer can drop them without an error.
    const layerNote = !adaptive.length
      ? ""
      : adaptive.every((a) => a.applied)
        ? ` · layers ${Math.min(...adaptive.map((a) => a.min)).toFixed(2)} to ${Math.max(...adaptive.map((a) => a.max)).toFixed(2)} mm`
        : " · adaptive layers not used, equal layers instead";
    setStep(job, "slice", "done", `${job.files.gcode.length} plate${job.files.gcode.length > 1 ? "s" : ""} sliced${layerNote}`);

    if (job.send) await runSend(job, 1);
    else {
      job.status = "done";
      save(job);
    }
  } catch (err) {
    fail(job, err);
  }
}

async function runSend(job: Job, plate: number) {
  try {
    const target = job.plates?.[plate - 1];
    const gcode = target?.gcode ?? job.files.gcode[0];
    const label = target ? ` · plate ${plate} of ${job.plates!.length}` : "";
    setStep(job, "upload", "running", label.slice(3));
    // The U1 runs one print at a time; the next plate waits until the bed is cleared.
    const status = await getStatus().catch(() => null);
    if (status && (status.state === "printing" || status.state === "paused")) {
      throw new Error(`The U1 is busy (${status.state}). Send ${target ? `plate ${plate}` : "it"} once the current print is done and the bed is cleared.`);
    }
    const remoteName = safeRemoteName(target ? `${job.title} plate ${plate}` : job.title);
    const r = await uploadGcode(gcode, remoteName, false);
    job.remoteName = r.item?.path ?? remoteName;
    if (target) target.remoteName = job.remoteName;
    setStep(job, "upload", "done", job.remoteName);

    setStep(job, "print", "running");
    // Tell the U1 which physical toolhead prints each logical tool of the file (T0 = model colour 1, ...).
    // The firmware refuses this while printing and resets it when a print ends.
    for (const [logical, physical] of job.filamentToTool.entries()) {
      await runGcode(`SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=${logical} MAP_EXTRUDER=${physical}`);
    }
    await startPrint(job.remoteName);
    const mapText = job.filamentToTool.map((t, i) => `T${i} on T${t + 1}`).join(", ");
    setStep(job, "print", "done", `Printing${label} · ${mapText}`);
    job.status = "done";
    save(job);
  } catch (err) {
    fail(job, err);
  }
}

function clampTool(n: number) {
  return Math.max(0, Math.min(3, Math.round(n)));
}

function sumStats(list: JobStats[]): JobStats {
  const sum = (key: "seconds" | "grams" | "toolChanges") => (list.every((s) => s[key] != null) ? list.reduce((n, s) => n + s[key]!, 0) : null);
  const byFilament = list.every((s) => s.gramsByFilament)
    ? Array.from({ length: Math.max(...list.map((s) => s.gramsByFilament!.length)) }, (_, i) => list.reduce((n, s) => n + (s.gramsByFilament![i] ?? 0), 0))
    : undefined;
  return { seconds: sum("seconds"), grams: sum("grams"), toolChanges: sum("toolChanges"), gramsByFilament: byFilament };
}

function readGcodeStats(file: string): JobStats {
  const text = fs.readFileSync(file, "utf8");
  const head = text.slice(0, 4000);
  const tail = text.slice(-60000);
  const grams = Number(/total filament used \[g\] = ([\d.]+)/.exec(tail)?.[1] ?? NaN);
  const time = /estimated printing time \(normal mode\) = (.+)/.exec(tail)?.[1] ?? "";
  const seconds = parseDuration(time);
  const toolChanges = (text.match(/^T[0-3]\s*$/gm) ?? []).length;
  const byFilament = /^; filament used \[g\] = (.+)$/m.exec(tail)?.[1].split(",").map(Number);
  void head;
  return {
    seconds: Number.isFinite(seconds) ? seconds : null,
    grams: Number.isFinite(grams) ? grams : null,
    toolChanges,
    gramsByFilament: byFilament?.every(Number.isFinite) ? byFilament : undefined,
  };
}

function parseDuration(s: string) {
  let total = 0;
  for (const [, n, unit] of s.matchAll(/(\d+)([dhms])/g)) total += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[unit as "d" | "h" | "m" | "s"];
  return s ? total : NaN;
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { JOB_DIR, readSettings } from "./store.ts";
import { downloadInstance, MakerWorldError } from "./makerworld.ts";
import { downloadProfile, SnapmakerError } from "./snapmaker.ts";
import { addGcodeThumbnails } from "./thumbnails.ts";
import { plateFilaments, readPlateThumbnail, readProject } from "./threemf.ts";
import { materialOf, presetForMaterial } from "./profiles.ts";
import { sliceForU1, sliceSnapmakerProfile, type PrintMode, type PrintOptions } from "./slicer.ts";
import type { PlateTransform } from "./geometry.ts";
import type { PlateEntry } from "./plate.ts";
import { combineProjects } from "./combine.ts";
import { getStatus, PrinterError, runGcode, safeRemoteName, startPrint, uploadGcode } from "./printer.ts";
import { uploadCoverPath, uploadFilePath, uploadProjectPath, type UploadKind } from "./uploads.ts";
import { isSiteId, isSourceId, siteForSource, sourceForSite, type SiteId, type SourceId } from "./sites.ts";

/** 模型作业负责下载或读取文件、切片，并按需上传到 U1。Snapmaker Space 作业使用原配置并仅上传。 */

export type StepKey = "download" | "presets" | "slice" | "upload" | "print";
export type StepState = "pending" | "running" | "done" | "error" | "skipped";

export type Job = {
  id: string;
  createdAt: string;
  site: SiteId;
  source: SourceId;
  designId: number;
  instanceId: number;
  snapmaker?: { modelId: string; profileId?: string };
  title: string;
  cover: string;
  mode: PrintMode;
  options: PrintOptions;
  overrides?: Record<string, string>;
  plate: number;
  /** Size and rotation of the plate; missing on jobs made before resizing existed. */
  transform?: PlateTransform;
  /** Set when several models are printed together on one plate. */
  items?: PlateJobItem[];
  /** Set for a file uploaded by hand; designId and instanceId are then 0. Missing kind means STL. */
  upload?: { id: string; name: string; kind?: UploadKind };
  filamentToTool: number[];
  /** Upload the G-code to the printer. */
  send: boolean;
  /** Start the print right after the upload; false sends it only, to be started on the printer. Missing on older jobs (they started it). */
  print?: boolean;
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
export type JobPlate = { gcode: string; project: string; stats: JobStats; remoteName: string | null; started?: boolean };

export type NewJob = Pick<Job, "site" | "designId" | "instanceId" | "snapmaker" | "title" | "cover" | "mode" | "options" | "overrides" | "plate" | "transform" | "items" | "upload" | "filamentToTool" | "send" | "print"> & { source?: SourceId };

export type PlateJobItem = Pick<
  PlateEntry,
  "site" | "designId" | "instanceId" | "uploadId" | "title" | "plate" | "size" | "rotation" | "orient" | "copies" | "bed" | "filamentToTool"
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
    const job = JSON.parse(fs.readFileSync(jobFile(id), "utf8")) as Job;
    const site = isSiteId(job.site) ? job.site : "intl";
    const source = isSourceId(job.source) ? job.source : sourceForSite(site);
    return { ...job, site: siteForSource(source) ?? site, source, print: source === "sm-intl" ? false : job.print };
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
  const site = isSiteId(input.site) ? input.site : "intl";
  const source = isSourceId(input.source) ? input.source : sourceForSite(site);
  const fromSnapmaker = source === "sm-intl";
  if (fromSnapmaker && !input.snapmaker?.modelId) throw new Error("请选择 Snapmaker Space 模型。");
  const job: Job = {
    ...input,
    site: siteForSource(source) ?? site,
    source,
    print: fromSnapmaker ? false : input.print ?? true,
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
              : fromSnapmaker ? "下载 Snapmaker Space 3MF" : STEP_LABELS[key],
      state: (!input.send && (key === "upload" || key === "print")) || (fromSnapmaker && (key === "presets" || key === "print")) ? "skipped" : "pending",
      detail: fromSnapmaker && key === "presets" ? "使用模型自带的 U1 配置" : "",
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

/**
 * Sends an already sliced job to the printer: its U1 plate number `plate` (1-based) when it has several.
 * With `print` false the file is only uploaded, for starting it on the printer's own screen.
 */
export function sendJob(id: string, plate = 1, print = true): Job {
  const job = getJob(id);
  if (!job) throw new Error("Job not found.");
  if (!job.files.gcode.length) throw new Error("This job has no G-code yet.");
  if (job.status === "running") throw new Error("This job is still running.");
  const count = job.plates?.length ?? 1;
  if (!Number.isInteger(plate) || plate < 1 || plate > count) throw new Error(`This job has no plate ${plate}.`);
  job.send = true;
  job.print = job.source !== "sm-intl" && print;
  job.status = "running";
  job.error = null;
  for (const s of job.steps) {
    if (s.key === "upload") s.state = "pending";
    if (s.key === "print") s.state = job.source === "sm-intl" ? "skipped" : "pending";
  }
  registry.set(job.id, job);
  save(job);
  void runSend(job, plate);
  return job;
}

/** Starts a job already uploaded to the printer, on its U1 plate number `plate` (1-based). */
export function printJob(id: string, plate = 1): Job {
  const job = getJob(id);
  if (!job) throw new Error("Job not found.");
  if (job.source === "sm-intl") throw new PrinterError("Snapmaker Space 作业仅支持上传。", 409);
  if (job.status === "running") throw new Error("This job is still running.");
  const count = job.plates?.length ?? 1;
  if (!Number.isInteger(plate) || plate < 1 || plate > count) throw new Error(`This job has no plate ${plate}.`);
  const remote = job.plates?.[plate - 1]?.remoteName ?? job.remoteName;
  if (!remote) throw new Error("This job is not on the printer yet. Send it first.");
  job.print = true;
  job.status = "running";
  job.error = null;
  const step = job.steps.find((s) => s.key === "print");
  if (step) step.state = "pending";
  registry.set(job.id, job);
  save(job);
  void (async () => {
    try {
      await startTarget(job, plate);
      job.status = "done";
      save(job);
    } catch (err) {
      fail(job, err);
    }
  })();
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
  job.errorCode = err instanceof MakerWorldError || err instanceof SnapmakerError ? err.code : null;
  save(job);
}

async function runJob(job: Job) {
  const dir = path.join(JOB_DIR, job.id);
  try {
    if (job.source === "sm-intl") {
      await sliceSnapmakerJob(job, dir);
      await finishJob(job);
      return;
    }
    const settings = readSettings();
    let inputs: string[];
    let mapping: number[];
    let filamentTypes: string[] = [];
    // Where the picture for the U1 file list comes from: the plate picture inside the source 3MF.
    let pictureSource: { file: string; plate: number } | null = null;
    if (job.upload?.kind === "3mf") {
      // A project file: handled like a MakerWorld download, with its own filaments and plates.
      setStep(job, "download", "running");
      const file = uploadFilePath(job.upload.id);
      setStep(job, "download", "done", `${job.upload.name}.3mf`);
      setStep(job, "presets", "running");
      const project = await readProject(file);
      const slots = project.filaments.length;
      filamentTypes = project.filaments.map((f) => f.type);
      mapping = Array.from({ length: slots }, (_, i) => clampTool(job.filamentToTool[i] ?? i % 4));
      setStep(job, "presets", "done", presetDetail(`${project.printer || "3MF"} → Snapmaker U1 · ${slots} filament${slots > 1 ? "s" : ""}`, filamentTypes, mapping, settings.tools));
      inputs = [file];
      pictureSource = { file, plate: job.plate };
    } else if (job.upload) {
      // A plain mesh: one filament, already in millimetres. The slicer step places it on the bed.
      setStep(job, "download", "running");
      inputs = [uploadFilePath(job.upload.id)];
      setStep(job, "download", "done", `${job.upload.name}.stl`);
      setStep(job, "presets", "running");
      mapping = [clampTool(job.filamentToTool[0] ?? 0)];
      filamentTypes = ["PLA"];
      setStep(job, "presets", "done", presetDetail("STL → Snapmaker U1 · 1 filament", filamentTypes, mapping, settings.tools));
    } else if (job.items?.length) {
      // Several models: download each, then merge them into one project per U1 plate where filament N is toolhead N.
      setStep(job, "download", "running");
      const files: string[] = [];
      for (const [i, item] of job.items.entries()) {
        setStep(job, "download", "running", `${i + 1} of ${job.items.length} · ${item.title}`);
        files.push(item.uploadId ? await uploadProjectPath(item.uploadId) : (await downloadInstance(item.instanceId, item.site ?? job.site)).file);
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
      // The merged plates carry no picture of their own, so the first model's plate picture is used.
      pictureSource = files.length ? { file: files[0], plate: job.items![0].plate } : null;
      mapping = [0, 1, 2, 3];
      filamentTypes = ["PLA", "PLA", "PLA", "PLA"];
      const where = inputs.length > 1 ? `${inputs.length} plates` : "one plate";
      setStep(job, "presets", "done", `${placed.copies} object${placed.copies > 1 ? "s" : ""} on ${where} · T1–T4`);
    } else {
      setStep(job, "download", "running");
      const download = await downloadInstance(job.instanceId, job.site);
      setStep(job, "download", "done", download.cached ? "Already downloaded" : download.name);

      setStep(job, "presets", "running");
      const project = await readProject(download.file);
      const slots = project.filaments.length;
      filamentTypes = project.filaments.map((f) => f.type);
      mapping = Array.from({ length: slots }, (_, i) => clampTool(job.filamentToTool[i] ?? i % 4));
      setStep(job, "presets", "done", presetDetail(`${project.printer || "Bambu"} → Snapmaker U1 · ${slots} filament${slots > 1 ? "s" : ""}`, filamentTypes, mapping, settings.tools));
      inputs = [download.file];
      pictureSource = { file: download.file, plate: job.plate };
    }
    job.filamentToTool = mapping;

    setStep(job, "slice", "running");
    const onLog = (line: string) => logLine(job, line);
    // One slicer run per U1 plate, one after the other to keep memory use down.
    const plates: JobPlate[] = [];
    const adaptive: NonNullable<Awaited<ReturnType<typeof sliceForU1>>["layers"]>[] = [];
    const picture = await sourcePicture(job, pictureSource);
    for (const [i, input] of inputs.entries()) {
      if (inputs.length > 1) setStep(job, "slice", "running", `Plate ${i + 1} of ${inputs.length}`);
      const used = await plateFilaments(input, job.items?.length ? 1 : job.plate);
      checkToolConflicts(used, mapping, i + 1);
      const result = await sliceForU1({
        input,
        workDir: path.join(dir, inputs.length > 1 ? `slice-${i + 1}` : "slice"),
        mode: job.mode,
        options: job.options,
        overrides: job.overrides,
        tools: settings.tools,
        filamentToTool: mapping,
        filamentTypes,
        plate: job.items?.length ? 1 : job.plate,
        transform: job.transform,
        onLog,
      });
      plates.push({ gcode: result.gcodeFiles[0], project: result.exported3mf, stats: readGcodeStats(result.gcodeFiles[0]), remoteName: null });
      // The slicer leaves the G-code thumbnails out when it runs without a display; write them in.
      if (addGcodeThumbnails(result.gcodeFiles[0], picture)) onLog("Wrote the file-list picture into the G-code");
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

    await finishJob(job);
  } catch (err) {
    fail(job, err);
  }
}

async function sliceSnapmakerJob(job: Job, dir: string) {
  if (!job.snapmaker) throw new Error("缺少 Snapmaker Space 模型信息。");
  setStep(job, "download", "running");
  const { modelId, profileId } = job.snapmaker;
  const download = await downloadProfile(modelId, profileId);
  setStep(job, "download", "done", download.cached ? `已缓存 · ${download.name}` : download.name);

  setStep(job, "slice", "running");
  const result = await sliceSnapmakerProfile({ input: download.file, workDir: path.join(dir, "slice"), onLog: (line) => logLine(job, line) });
  job.files = { gcode: result.gcodeFiles, project: result.exported3mf };
  job.stats = sumStats(result.gcodeFiles.map(readGcodeStats));
  setStep(job, "slice", "done", `已切片 ${result.gcodeFiles.length} 盘`);
}

function logLine(job: Job, line: string) {
  job.log.push(line);
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}

async function finishJob(job: Job) {
  if (job.send) await runSend(job, 1);
  else {
    job.status = "done";
    save(job);
  }
}

async function runSend(job: Job, plate: number) {
  try {
    await uploadTarget(job, plate);
    if (job.source === "sm-intl") {
      setStep(job, "print", "skipped", "已上传");
    } else if (job.print === false) {
      // Only the file goes to the printer: it waits in the file list until it is started there.
      setStep(job, "print", "pending", "已发送 · 在打印机上点“开始打印”");
    } else {
      await startTarget(job, plate);
    }
    job.status = "done";
    save(job);
  } catch (err) {
    fail(job, err);
  }
}

/** Uploads the G-code of one plate to the printer; the print itself is started by startTarget. */
async function uploadTarget(job: Job, plate: number) {
  const target = job.plates?.[plate - 1];
  const fromSnapmaker = job.source === "sm-intl";
  const file = fromSnapmaker ? job.files.project : target?.gcode ?? job.files.gcode[0];
  if (!file) throw new Error("缺少可上传的切片文件。");
  setStep(job, "upload", "running", target ? `plate ${plate} of ${job.plates!.length}` : "");
  const remoteName = safeRemoteName(target ? `${job.title} plate ${plate}` : job.title) + (fromSnapmaker ? ".3mf" : "");
  const r = await uploadGcode(file, remoteName, false);
  job.remoteName = r.item?.path ?? remoteName;
  if (target) target.remoteName = job.remoteName;
  setStep(job, "upload", "done", job.remoteName);
}

/** Tells the U1 which toolhead prints each filament, then starts the file already on the printer. */
async function startTarget(job: Job, plate: number) {
  // 在发出任何打印机命令之前，再检查作业是否允许启动。
  if (job.source === "sm-intl") throw new PrinterError("Snapmaker Space 作业仅支持上传。", 409);
  const target = job.plates?.[plate - 1];
  const label = target ? ` · plate ${plate} of ${job.plates!.length}` : "";
  const remoteName = target?.remoteName ?? job.remoteName;
  if (!remoteName) throw new Error("This plate is not on the printer yet. Send it first.");
  // The U1 runs one print at a time; the next plate waits until the bed is cleared.
  const status = await getStatus().catch(() => null);
  if (status && (status.state === "printing" || status.state === "paused")) {
    throw new Error(`The U1 is busy (${status.state}). Start ${target ? `plate ${plate}` : "it"} once the current print is done and the bed is cleared.`);
  }
  setStep(job, "print", "running");
  // Tell the U1 which physical toolhead prints each logical tool of the file (T0 = model colour 1, ...).
  // The firmware refuses this while printing and resets it when a print ends.
  for (const [logical, physical] of job.filamentToTool.entries()) {
    await runGcode(`SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=${logical} MAP_EXTRUDER=${physical}`);
  }
  await startPrint(remoteName);
  job.remoteName = remoteName;
  if (target) target.started = true;
  const mapText = job.filamentToTool.map((t, i) => `T${i} on T${t + 1}`).join(", ");
  setStep(job, "print", "done", `Printing${label} · ${mapText}`);
}

/** The picture the U1 shows in its file list: the plate render inside the source 3MF, else the upload's own picture. */
async function sourcePicture(job: Job, source: { file: string; plate: number } | null): Promise<Buffer | null> {
  if (source) {
    const png = await readPlateThumbnail(source.file, source.plate).catch(() => null);
    if (png) return png;
  }
  if (job.upload) {
    const cover = uploadCoverPath(job.upload.id);
    if (cover && fs.existsSync(cover.file)) return fs.readFileSync(cover.file);
  }
  return null;
}

function clampTool(n: number) {
  return Math.max(0, Math.min(3, Math.round(n)));
}

function presetDetail(base: string, filamentTypes: string[], mapping: number[], tools: { preset: string }[]) {
  const notes: string[] = [];
  for (let i = 0; i < filamentTypes.length; i++) {
    const requested = materialOf(filamentTypes[i]);
    const loaded = materialOf(tools[mapping[i] ?? 0]?.preset ?? "");
    if (!requested) {
      notes.push(`槽${i + 1} ${filamentTypes[i]} → Snapmaker PLA @U1（找不到匹配材料，已回退）`);
    } else if (requested !== loaded) {
      notes.push(`槽${i + 1} ${filamentTypes[i]} → ${presetForMaterial(requested)}（喷头装的是 ${loaded ?? "未知材料"}）`);
    }
  }
  return notes.length ? `${base} · ${notes.join("；")}` : base;
}

function checkToolConflicts(used: number[], mapping: number[], plate: number) {
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const first = used[i];
      const second = used[j];
      if ((mapping[first - 1] ?? 0) === (mapping[second - 1] ?? 0)) {
        const tool = (mapping[first - 1] ?? 0) + 1;
        throw new Error(`第 ${plate} 盘的颜色 ${first} 和颜色 ${second} 都会用 T${tool} 打印，U1 一个喷头不能同时装两种料。请在打印设置里把其中一个改到别的喷头，或分成两次打印。`);
      }
    }
  }
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

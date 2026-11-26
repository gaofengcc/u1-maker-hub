import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { flattenPreset, materialOf, presetForMaterial, SLICER_BIN, U1_MACHINE } from "./profiles.ts";

const execFileAsync = promisify(execFile);

/** 分组所需的耗材信息。slot 使用 1-based 编号，与 3MF 的 extruder 一致。 */
export type ArrangeFilament = { color: string; type?: string; preset?: string };
export type ArrangePart = { id?: string | number; slot: number; count?: number };
export type ArrangeProject = {
  filaments: ArrangeFilament[];
  parts: ArrangePart[];
};

export type PaletteGroup = {
  index: number;
  material: string;
  slots: number[];
  colors: string[];
  parts: number;
  /** 由调用方预先生成的完整四喷头 project settings，可避免依赖本机配置路径。 */
  fullConfig?: Record<string, unknown>;
};

export type ArrangeResult = {
  file: string;
  plates: number;
  log: string;
};

export type PlateSliceResult = {
  plate: number;
  exitCode: number;
  gcode?: string;
  grams: number | null;
  minutes: number | null;
  log: string;
};

function slotCount(project: ArrangeProject, slot: number) {
  return project.parts.filter((part) => part.slot === slot).reduce((n, part) => n + (part.count ?? 1), 0);
}

/**
 * 按材料类型隔离，再按零件数量降序把颜色放入当前零件数最少且未满的箱子。
 * 所有并列情况都使用槽号作为次级排序，结果不依赖时间、随机数或对象遍历顺序。
 */
export function groupByPalette(project: ArrangeProject): PaletteGroup[] {
  const used = new Set(project.parts.map((part) => part.slot));
  const byMaterial = new Map<string, number[]>();
  for (const slot of [...used].sort((a, b) => a - b)) {
    const filament = project.filaments[slot - 1] ?? project.filaments[0] ?? { type: "PLA", color: "#FFFFFF" };
    const material = materialOf(filament.type ?? filament.preset ?? "PLA") ?? String(filament.type ?? "PLA").toUpperCase();
    const slots = byMaterial.get(material) ?? [];
    slots.push(slot);
    byMaterial.set(material, slots);
  }

  const groups: PaletteGroup[] = [];
  for (const material of [...byMaterial.keys()].sort((a, b) => a.localeCompare(b))) {
    const slots = byMaterial.get(material)!;
    slots.sort((a, b) => slotCount(project, b) - slotCount(project, a) || a - b);
    const bins: { slots: number[]; parts: number }[] = [];
    for (const slot of slots) {
      const target = bins
        .filter((bin) => bin.slots.length < 4)
        .sort((a, b) => a.parts - b.parts || a.slots[0] - b.slots[0])[0];
      const count = slotCount(project, slot);
      if (target) {
        target.slots.push(slot);
        target.parts += count;
      } else {
        bins.push({ slots: [slot], parts: count });
      }
    }
    for (const bin of bins) {
      bin.slots.sort((a, b) => a - b);
      groups.push({
        index: groups.length + 1,
        material,
        slots: bin.slots,
        colors: bin.slots.map((slot) => project.filaments[slot - 1]?.color ?? "#FFFFFF"),
        parts: bin.parts,
      });
    }
  }
  return groups;
}

/** 从 3MF 读取分组所需的槽位和对象数量。 */
export async function readArrangeProject(file: string): Promise<ArrangeProject> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const settings = parseJson((await zip.file("Metadata/project_settings.config")?.async("string")) ?? "{}");
  const colors = asArray(settings.filament_colour);
  const types = asArray(settings.filament_type);
  const presets = asArray(settings.filament_settings_id);
  const filaments = (colors.length ? colors : ["#FFFFFF"]).map((color, i) => ({
    color: normalizeColor(color),
    type: types[i] ?? types[0] ?? "PLA",
    preset: presets[i] ?? "",
  }));
  const modelSettings = (await zip.file("Metadata/model_settings.config")?.async("string")) ?? "";
  const objectSlot = new Map<string, number>();
  for (const object of modelSettings.match(/<object\b[\s\S]*?<\/object>/g) ?? []) {
    const id = /<object\b[^>]*\bid="(\d+)"/.exec(object)?.[1];
    const slot = Number(/<metadata\b[^>]*\bkey="extruder"[^>]*\bvalue="(\d+)"/.exec(object)?.[1]);
    if (id && Number.isInteger(slot) && slot > 0) objectSlot.set(id, slot);
  }
  const model = (await zip.file("3D/3dmodel.model")?.async("string")) ?? "";
  const parts: ArrangePart[] = [];
  for (const item of model.match(/<item\b[^>]*\/>/g) ?? []) {
    const id = /\bobjectid="(\d+)"/.exec(item)?.[1];
    const slot = id ? objectSlot.get(id) : undefined;
    if (slot) parts.push({ id, slot });
  }
  return { filaments, parts };
}

/**
 * 创建一个只包含指定颜色组的 3MF 副本。所有原始 build item 都保留，组外对象通过
 * printable="0" 排除，避免 OrcaSlicer 因缺失 build item 返回 -6。
 */
export async function buildGroupProject(srcFile: string, palette: PaletteGroup, outFile: string): Promise<void> {
  const zip = await JSZip.loadAsync(fs.readFileSync(srcFile));
  const model = (await zip.file("3D/3dmodel.model")?.async("string")) ?? "";
  const modelSettings = (await zip.file("Metadata/model_settings.config")?.async("string")) ?? "";
  const sourceSettings = parseJson((await zip.file("Metadata/project_settings.config")?.async("string")) ?? "{}");
  const fullConfig = palette.fullConfig ?? findFullConfig();
  if (!fullConfig) throw new Error("缺少 Orca 生成的完整四喷头配置，请先生成 full4.json。");
  const sourceColors = asArray(sourceSettings.filament_colour);
  const sourceTypes = asArray(sourceSettings.filament_type);
  const remap = new Map(palette.slots.map((slot, i) => [slot, i + 1]));
  const selectedObjects = new Set<string>();
  for (const object of modelSettings.match(/<object\b[\s\S]*?<\/object>/g) ?? []) {
    const id = /<object\b[^>]*\bid="(\d+)"/.exec(object)?.[1];
    const slot = Number(/<metadata\b[^>]*\bkey="extruder"[^>]*\bvalue="(\d+)"/.exec(object)?.[1]);
    if (id && remap.has(slot)) selectedObjects.add(id);
  }

  const modelOutput = model.replace(/<item\b[^>]*\/>/g, (item) => {
    const id = /\bobjectid="(\d+)"/.exec(item)?.[1];
    const keep = id ? selectedObjects.has(id) : false;
    if (/\bprintable="[01]"/.test(item)) return item.replace(/\bprintable="[01]"/, `printable="${keep ? 1 : 0}"`);
    return item.replace(/\/>$/, ` printable="${keep ? 1 : 0}"/>`);
  });

  const settingsOutput = modelSettings
    .replace(/(<metadata\b[^>]*\bkey="extruder"[^>]*\bvalue=")\d+(")/g, (whole, head: string, tail: string) => {
      const current = Number(/value="(\d+)"/.exec(whole)?.[1]);
      return `${head}${remap.get(current) ?? 1}${tail}`;
    })
    .replace(/<model_instance>([\s\S]*?)<\/model_instance>/g, (whole, body: string) => {
      const id = /key="object_id"\s+value="(\d+)"/.exec(body)?.[1];
      return id && selectedObjects.has(id) ? whole : "";
    });

  // Orca 要求盘元数据中的数组长度与四个物理槽严格一致。沿用第一盘，只替换实例。
  const firstPlate = /<plate>[\s\S]*?<\/plate>/.exec(modelSettings)?.[0];
  let finalModelSettings = settingsOutput.replace(/<plate>[\s\S]*?<\/plate>/g, "");
  if (firstPlate) {
    const plate = firstPlate
      .replace(/<model_instance>[\s\S]*?<\/model_instance>/g, "")
      .replace(/(key="filament_maps"\s+value=")[^"]*"/, `$1${Array(4).fill("1").join(" ")}\"`)
      .replace(/(key="filament_volume_maps"\s+value=")[^"]*"/, `$1${Array(4).fill("0").join(" ")}\"`);
    const instances = [...settingsOutput.matchAll(/<model_instance>[\s\S]*?<\/model_instance>/g)]
      .filter((match) => {
        const id = /key="object_id"\s+value="(\d+)"/.exec(match[0])?.[1];
        return Boolean(id && selectedObjects.has(id));
      })
      .map((match) => match[0])
      .join("");
    finalModelSettings = finalModelSettings.replace("</config>", `${plate.replace("</plate>", "")}${instances}</plate></config>`);
  }

  const outputSettings: Record<string, unknown> = { ...fullConfig };
  outputSettings.filament_colour = [...palette.slots.map((slot) => sourceColors[slot - 1] ?? "#FFFFFF"), ...Array(4 - palette.slots.length).fill(sourceColors[palette.slots[palette.slots.length - 1] - 1] ?? "#FFFFFF")];
  outputSettings.filament_type = [...palette.slots.map((slot) => sourceTypes[slot - 1] ?? palette.material), ...Array(4 - palette.slots.length).fill(sourceTypes[palette.slots[palette.slots.length - 1] - 1] ?? palette.material)];
  const settingsJson = JSON.stringify(outputSettings, null, 2);

  zip.file("3D/3dmodel.model", modelOutput);
  zip.file("Metadata/model_settings.config", finalModelSettings);
  zip.file("Metadata/project_settings.config", settingsJson);
  zip.forEach((name) => {
    if (/^Metadata\/(slice_info\.config|plate_\d+\.gcode(?:\.md5)?|filament_settings_\d+\.config)$/.test(name)) zip.remove(name);
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

export type ArrangeOptions = {
  outputDir: string;
  exportName?: string;
  slicerBin?: string;
  timeoutMs?: number;
  loadSettings?: string;
  loadFilaments?: string;
};

/** 用 Orca 生成完整的四喷头配置，避免手工裁剪 project_settings 数组。 */
export async function generateFullU1Config(workDir: string, material = "PLA"): Promise<Record<string, unknown>> {
  fs.mkdirSync(workDir, { recursive: true });
  const presetDir = path.join(workDir, "presets");
  fs.mkdirSync(presetDir, { recursive: true });
  const machine = path.join(presetDir, "machine.json");
  const processPath = path.join(presetDir, "process.json");
  fs.writeFileSync(machine, JSON.stringify(flattenPreset(U1_MACHINE), null, 2));
  fs.writeFileSync(processPath, JSON.stringify(flattenPreset("0.20 Standard @Snapmaker U1 (0.4 nozzle)"), null, 2));
  const filaments: string[] = [];
  for (let i = 0; i < 4; i++) {
    const file = path.join(presetDir, `filament_${i + 1}.json`);
    const preset = flattenPreset(presetForMaterial(material));
    preset.filament_colour = ["#FFFFFF"];
    fs.writeFileSync(file, JSON.stringify(preset, null, 2));
    filaments.push(file);
  }
  const probe = path.join(presetDir, "probe.stl");
  fs.writeFileSync(probe, cubeStl(10));
  const output = path.join(workDir, "full4.json");
  const command = process.platform === "linux" && path.basename(SLICER_BIN) !== "xvfb-run" ? "xvfb-run" : SLICER_BIN;
  const args = command === "xvfb-run" ? ["-a", SLICER_BIN] : [];
  args.push("--load-settings", `${machine};${processPath}`, "--load-filaments", filaments.join(";"), "--export-settings", output, probe);
  await execFileAsync(command, args, { cwd: workDir, timeout: 900_000, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(fs.readFileSync(output, "utf8")) as Record<string, unknown>;
}

function cubeStl(size: number) {
  const v = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return `solid cube\n${faces.map(([a, b, c]) => `facet normal 0 0 0\nouter loop\nvertex ${v[a].join(" ")}\nvertex ${v[b].join(" ")}\nvertex ${v[c].join(" ")}\nendloop\nendfacet`).join("\n")}\nendsolid cube\n`;
}

/** 调 Orca 摆盘。只允许绕 Z 轴旋转，禁止翻转。 */
export async function arrangeGroup(file: string, opts: ArrangeOptions): Promise<ArrangeResult> {
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const exportName = opts.exportName ?? "arranged.3mf";
  const args = [
    ...(opts.loadSettings ? ["--load-settings", opts.loadSettings] : []),
    ...(opts.loadFilaments ? ["--load-filaments", opts.loadFilaments] : []),
    "--allow-newer-file", "--arrange", "1", "--allow-rotations",
    "--outputdir", opts.outputDir, "--export-3mf", exportName, file,
  ];
  const result = await runSlicer(opts.slicerBin ?? SLICER_BIN, args, path.dirname(file), opts.timeoutMs ?? 900_000);
  const output = path.join(opts.outputDir, exportName);
  if (!fs.existsSync(output)) throw new Error(`OrcaSlicer 未生成摆盘文件: ${output}`);
  const plates = await countPlates(output);
  return { file: output, plates, log: result.log };
}

/** 逐盘切片并读取 G-code 中 Orca 写入的耗材和时间统计。盘号是 1-based。 */
export async function sliceAllPlates(file: string, opts: Omit<ArrangeOptions, "exportName"> = { outputDir: path.join(path.dirname(file), "sliced") }): Promise<PlateSliceResult[]> {
  const count = await countPlates(file);
  const results: PlateSliceResult[] = [];
  for (let plate = 1; plate <= count; plate++) {
    const outputDir = path.join(opts.outputDir, `plate-${plate}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const args = [
      ...(opts.loadSettings ? ["--load-settings", opts.loadSettings] : []),
      ...(opts.loadFilaments ? ["--load-filaments", opts.loadFilaments] : []),
      "--allow-newer-file", "--slice", String(plate), "--outputdir", outputDir,
      "--export-3mf", `slice-${plate}.3mf`, file,
    ];
    try {
      const run = await runSlicer(opts.slicerBin ?? SLICER_BIN, args, path.dirname(file), opts.timeoutMs ?? 900_000);
      const gcode = fs.readdirSync(outputDir).find((name) => name.endsWith(".gcode"));
      const stats = gcode ? readGcodeStats(path.join(outputDir, gcode)) : { grams: null, minutes: null };
      results.push({ plate, exitCode: 0, gcode: gcode ? path.join(outputDir, gcode) : undefined, ...stats, log: run.log });
    } catch (error) {
      const err = error as Error & { code?: number; stdout?: string; stderr?: string };
      results.push({ plate, exitCode: typeof err.code === "number" ? err.code : 1, grams: null, minutes: null, log: `${err.message}\n${err.stderr ?? ""}` });
    }
  }
  return results;
}

async function countPlates(file: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const text = (await zip.file("Metadata/model_settings.config")?.async("string")) ?? "";
  return Math.max(1, (text.match(/<plate\b/g) ?? []).length);
}

function runSlicer(bin: string, args: string[], cwd: string, timeout: number) {
  const command = process.platform === "linux" && path.basename(bin) !== "xvfb-run" ? "xvfb-run" : bin;
  const commandArgs = command === "xvfb-run" ? ["-a", bin, ...args] : args;
  return execFileAsync(command, commandArgs, { cwd, timeout, maxBuffer: 20 * 1024 * 1024 }).then((result) => ({ log: `${result.stdout}\n${result.stderr}` }));
}

function readGcodeStats(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const gramsMatch = /total filament used \[g\]\s*[:=]\s*([^\r\n]+)/i.exec(text);
  const timeMatch = /estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)/i.exec(text)
    ?? /total estimated printing time\s*[:=]\s*([^\r\n]+)/i.exec(text);
  return { grams: gramsMatch ? Number(gramsMatch[1]) : null, minutes: timeMatch ? parseTime(timeMatch[1]) : null };
}

function parseTime(value: string) {
  const days = /(\d+)d/i.exec(value)?.[1];
  const hours = /(\d+)h/i.exec(value)?.[1];
  const minutes = /(\d+)m/i.exec(value)?.[1];
  const seconds = /(\d+)s/i.exec(value)?.[1];
  const total = Number(days ?? 0) * 24 * 60 + Number(hours ?? 0) * 60 + Number(minutes ?? 0) + Number(seconds ?? 0) / 60;
  return total || null;
}

function parseJson(text: string): Record<string, any> {
  try { return JSON.parse(text.replace(/^﻿/, "")) as Record<string, any>; } catch { return {}; }
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return value.split(";");
  return [];
}

function normalizeColor(value: string) {
  return `#${value.trim().replace(/^#/, "").slice(0, 6).toUpperCase().padEnd(6, "F")}`;
}

function findFullConfig(): Record<string, unknown> | null {
  const candidates = [process.env.ARRANGE_FULL4, "/tmp/arr29/mk4/full4.json", path.join(process.cwd(), "data", "full4.json")].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { return JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, unknown>; } catch { /* try next */ }
  }
  return null;
}

import fs from "node:fs";
import JSZip from "jszip";
import { NO_TRANSFORM, transformPlate, type PlateTransform } from "./geometry.ts";
import { writeLayerHeights, type LayerLimits, type LayerPlan } from "./layerHeights.ts";
import type { PrintOptions } from "./slicer.ts";

/** What the app needs to know about a Bambu Studio / OrcaSlicer project file. */
export type CreatorPreset = {
  /** 作者在 3MF 中表达的模型意图量，速度、温度和加速度故意不包含在内。 */
  options: Partial<PrintOptions>;
  layerHeight: number | null;
  wallLoops: number | null;
  infillDensity: number | null;
  infillPattern: string | null;
  supportAngle: number | null;
  brimType: string | null;
  brimWidth: number | null;
  materialTypes: string[];
  materialColors: string[];
  printer: string;
  plateCount: number;
  /** model_settings.config 中带对象级意图覆盖的对象数。 */
  objectOverrides: number;
};

export type ProjectInfo = {
  application: string;
  printer: string;
  filaments: { color: string; type: string; preset: string }[];
  plates: { index: number; name: string }[];
  /** Supports as the creator set them: for the whole project, or on at least one object. */
  supports: "off" | "auto" | "plate";
  /** 作者配置，读取失败或纯几何 3MF 时为 null。 */
  creator: CreatorPreset | null;
  /** 带 enable_support / wall_loops / sparse_infill_* 对象级覆盖的对象数量。 */
  objectOverrides: number;
};

const PROJECT_SETTINGS = "Metadata/project_settings.config";
const MODEL_SETTINGS = "Metadata/model_settings.config";

export async function readProject(file: string): Promise<ProjectInfo> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const settingsText = await zip.file(PROJECT_SETTINGS)?.async("string");
  const settings = settingsText ? safeJson(settingsText) : {};
  const colors = asArray(settings.filament_colour);
  const types = asArray(settings.filament_type);
  const presets = asArray(settings.filament_settings_id);
  const filaments = colors.map((color, i) => ({
    color: normalizeColor(color),
    type: types[i] ?? types[0] ?? "PLA",
    preset: presets[i] ?? "",
  }));

  const modelText = (await zip.file(MODEL_SETTINGS)?.async("string")) ?? "";
  const plates: ProjectInfo["plates"] = [];
  for (const block of modelText.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const index = Number(/key="plater_id" value="(\d+)"/.exec(block)?.[1] ?? plates.length + 1);
    const name = /key="plater_name" value="([^"]*)"/.exec(block)?.[1] ?? "";
    plates.push({ index, name });
  }

  const modelXml = (await zip.file("3D/3dmodel.model")?.async("string")) ?? "";
  const application = /name="Application">([^<]*)</.exec(modelXml.slice(0, 4000))?.[1] ?? "";

  // The U1 settings replace the project's, so this is the only trace of the creator's choice.
  const projectSupports = String(settings.enable_support ?? "0") === "1";
  const objectSupports = /key="enable_support" value="1"/.test(modelText);
  const supports: ProjectInfo["supports"] = projectSupports
    ? String(settings.support_on_build_plate_only ?? "0") === "1" ? "plate" : "auto"
    : objectSupports ? "auto" : "off";

  const objectOverrides = countObjectOverrides(modelText);
  const layerHeight = numberValue(settings.layer_height);
  const wallLoops = numberValue(settings.wall_loops);
  const infillDensity = percentValue(settings.sparse_infill_density);
  const infillPattern = stringValue(settings.sparse_infill_pattern);
  const supportAngle = numberValue(settings.support_threshold_angle);
  const brimType = stringValue(settings.brim_type);
  const brimWidth = numberValue(settings.brim_width);
  const printer = String(settings.printer_settings_id ?? settings.printer_model ?? "");
  const hasCreatorSettings = Boolean(settingsText && Object.keys(settings).some((key) => [
    "layer_height", "wall_loops", "sparse_infill_density", "sparse_infill_pattern", "enable_support",
    "support_threshold_angle", "brim_type", "brim_width", "ironing_type", "seam_position",
    "filament_type", "filament_colour", "printer_settings_id", "printer_model",
  ].includes(key)));
  const creator: CreatorPreset | null = hasCreatorSettings ? {
    options: {
      ...(infillDensity != null ? { infillDensity } : {}),
      ...(infillPattern && ["gyroid", "grid", "crosshatch", "cubic", "lightning", "honeycomb"].includes(infillPattern) ? { infillPattern: infillPattern as PrintOptions["infillPattern"] } : {}),
      ...(wallLoops != null ? { wallLoops } : {}),
      supports,
      ...(brimType ? { brim: brimType === "no_brim" ? "none" : brimType === "outer_only" ? "always" : "auto" } : {}),
      ironing: stringValue(settings.ironing_type) === "top",
      ...(stringValue(settings.seam_position) && ["aligned", "back", "nearest", "random"].includes(stringValue(settings.seam_position)) ? { seam: stringValue(settings.seam_position) as PrintOptions["seam"] } : {}),
      layers: "fixed",
    },
    layerHeight,
    wallLoops,
    infillDensity,
    infillPattern,
    supportAngle,
    brimType,
    brimWidth,
    materialTypes: types,
    materialColors: colors.map(normalizeColor),
    printer,
    plateCount: plates.length || 1,
    objectOverrides,
  } : null;

  return {
    application,
    supports,
    creator,
    objectOverrides,
    printer,
    filaments: filaments.length ? filaments : [{ color: "#FFFFFF", type: "PLA", preset: "" }],
    plates: plates.length ? plates : [{ index: 1, name: "" }],
  };
}

/** 返回指定盘实际引用到的模型耗材序号（1-based，去重并排序）。 */
export async function plateFilaments(file: string, plate: number): Promise<number[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const modelText = (await zip.file(MODEL_SETTINGS)?.async("string")) ?? "";
  const blocks = modelText.match(/<plate>[\s\S]*?<\/plate>/g) ?? [];
  if (!blocks.length) return [];
  const objectFilaments = new Map<number, number>();
  for (const object of modelText.match(/<object\b[\s\S]*?<\/object>/g) ?? []) {
    const objectId = Number(/<object\b[^>]*\bid="(\d+)"/.exec(object)?.[1] ?? NaN);
    const filament = Number(/<metadata\b[^>]*\bkey="extruder"[^>]*\bvalue="(\d+)"/.exec(object)?.[1] ?? NaN);
    if (Number.isInteger(objectId) && objectId > 0 && Number.isInteger(filament) && filament > 0) objectFilaments.set(objectId, filament);
  }
  let selected = blocks;
  if (plate > 0) {
    const byId = blocks.find((block) => Number(/key="plater_id" value="(\d+)"/.exec(block)?.[1] ?? NaN) === plate);
    selected = byId ? [byId] : blocks[plate - 1] ? [blocks[plate - 1]] : [];
  }
  const used = new Set<number>();
  for (const block of selected) {
    for (const match of block.matchAll(/<model_instance\b[\s\S]*?<metadata\b[^>]*\bkey="object_id"[^>]*\bvalue="(\d+)"[\s\S]*?<\/model_instance>/g)) {
      const filament = objectFilaments.get(Number(match[1]));
      if (filament) used.add(filament);
    }
  }
  return [...used].sort((a, b) => a - b);
}

/**
 * Writes a copy of the project where the Bambu printer, process and filament
 * settings are replaced by a complete U1 configuration. Geometry, plates,
 * colour painting and per-object settings are kept. The chosen plate can also
 * be resized and rotated, since OrcaSlicer's --scale and --rotate refuse 3MF projects.
 * With `layers`, the plate also gets adaptive layer heights; the plan is returned.
 */
export async function replaceProjectSettings(
  src: string,
  dst: string,
  config: Record<string, unknown>,
  { plate = 0, transform = NO_TRANSFORM, layers }: { plate?: number; transform?: PlateTransform; layers?: LayerLimits } = {},
): Promise<LayerPlan | null> {
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  zip.file(PROJECT_SETTINGS, JSON.stringify(config, null, 4));
  const placed = await transformPlate(zip, src, plate, transform);
  // After the transform: the heights depend on how the pieces lie and on their size.
  const plan = layers ? writeLayerHeights(zip, placed, plate, layers) : null;
  // Leftovers from a Bambu slice would otherwise be carried into the output.
  zip.forEach((name) => {
    if (/^Metadata\/(plate_\d+\.gcode(\.md5)?|filament_settings_\d+\.config|slice_info\.config)$/.test(name)) zip.remove(name);
  });
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(dst, out);
  return plan;
}

export async function readPlateThumbnail(file: string, plate: number): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const entry = zip.file(`Metadata/plate_${plate}.png`) ?? zip.file("Auxiliaries/.thumbnails/thumbnail_3mf.png");
  return entry ? entry.async("nodebuffer") : null;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return {};
  }
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return value.split(";");
  return [];
}

function normalizeColor(color: string) {
  const hex = color.trim().replace(/^#/, "");
  return `#${hex.slice(0, 6).toUpperCase().padEnd(6, "F")}`;
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown): string {
  const v = firstValue(value);
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function numberValue(value: unknown): number | null {
  const n = Number(String(firstValue(value) ?? "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function percentValue(value: unknown): number | null {
  return numberValue(value);
}

function countObjectOverrides(modelText: string): number {
  let count = 0;
  for (const block of modelText.match(/<object\b[\s\S]*?<\/object>/g) ?? []) {
    if (/(?:key="(?:enable_support|wall_loops|sparse_infill_[^"]*)"\s+value=|key="(?:enable_support|wall_loops|sparse_infill_[^"]*)"\s+value=)/.test(block)) count++;
  }
  return count;
}

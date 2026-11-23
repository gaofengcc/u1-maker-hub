import fs from "node:fs";
import JSZip from "jszip";
import { NO_TRANSFORM, transformPlate, type PlateTransform } from "./geometry.ts";
import { writeLayerHeights, type LayerLimits, type LayerPlan } from "./layerHeights.ts";

/** What the app needs to know about a Bambu Studio / OrcaSlicer project file. */
export type ProjectInfo = {
  application: string;
  printer: string;
  filaments: { color: string; type: string; preset: string }[];
  plates: { index: number; name: string }[];
  /** Supports as the creator set them: for the whole project, or on at least one object. */
  supports: "off" | "auto" | "plate";
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

  return {
    application,
    supports,
    printer: String(settings.printer_settings_id ?? settings.printer_model ?? ""),
    filaments: filaments.length ? filaments : [{ color: "#FFFFFF", type: "PLA", preset: "" }],
    plates: plates.length ? plates : [{ index: 1, name: "" }],
  };
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

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { flattenPreset, SLICER_BIN, U1_MACHINE, type Preset } from "./profiles.ts";
import { replaceProjectSettings } from "./threemf.ts";
import { isIdentity, NO_TRANSFORM, type PlateTransform } from "./geometry.ts";
import { parseStl, stlTo3mf, writeTransformedStl } from "./stl.ts";
import { isNoOrient } from "./orient.ts";
import { addLayerHeights, layersApplied, type LayerLimits, type LayerPlan } from "./layerHeights.ts";

/**
 * Changes to the printer preset for every print. The stock "Auto Lift" picks a spiral lift, which the U1
 * firmware rejects near the bed edges (errors 0003-0522-0000-0013 and -0000) and which can clip tall parts.
 */
const RELIABILITY_MACHINE: Record<string, string> = {
  z_hop_types: "Normal Lift",
};

/**
 * Changes to the process preset for every print, to avoid detached parts and spaghetti:
 * - a slower first layer, so it bonds well (stock 50 mm/s, infill 105 mm/s);
 * - travel that goes around walls, so the nozzle does not hit or knock over thin parts;
 * - longer prime tower ribs, because the stock tower can fall over on tall multicolour prints;
 * - thicker organic tree branches and one more interface layer, so supports do not snap or fall.
 */
const RELIABILITY_PROCESS: Record<string, string> = {
  initial_layer_speed: "35",
  initial_layer_infill_speed: "60",
  reduce_crossing_wall: "1",
  wipe_tower_extra_rib_length: "8",
  tree_support_branch_diameter_organic: "3",
  support_interface_top_layers: "3",
};

/** The print presets offered in the UI. Each is an official U1 process plus the reliability changes and its own overrides. */
export const PRINT_MODES = {
  fast: {
    label: "Fast & clean",
    description: "0.20 mm layers, walls at 210 mm/s to avoid surface ripples, gyroid infill.",
    process: "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
    overrides: { outer_wall_speed: "210", inner_wall_speed: "210" } as Record<string, string>,
  },
  standard: {
    label: "Standard",
    description: "The official Snapmaker 0.20 mm profile, with a slower first layer and safer travel.",
    process: "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
    overrides: {} as Record<string, string>,
  },
  fine: {
    label: "Fine detail",
    description: "Official 0.12 mm profile with hidden seams. Smoother curves, about twice as long.",
    process: "0.12 Fine @Snapmaker U1 (0.4 nozzle)",
    // Scarf seams on the outer wall, only where the seam would otherwise show on a smooth curve.
    overrides: { seam_slope_type: "external", seam_slope_conditional: "1" } as Record<string, string>,
  },
} as const;
export type PrintMode = keyof typeof PRINT_MODES;

/** The settings a beginner can change, mapped to slicer keys. */
export type PrintOptions = {
  infillDensity: number; // percent
  infillPattern: "gyroid" | "grid" | "crosshatch" | "cubic" | "lightning" | "honeycomb";
  wallLoops: number;
  supports: "off" | "auto" | "plate";
  brim: "none" | "auto" | "always";
  ironing: boolean;
  seam: "aligned" | "back" | "nearest" | "random";
  /** fixed: the preset's layer height. adaptive: thinner on gentle slopes. balanced: also thicker on steep walls. */
  layers: "fixed" | "adaptive" | "balanced";
};

export const DEFAULT_OPTIONS: PrintOptions = {
  infillDensity: 15,
  infillPattern: "gyroid",
  wallLoops: 2,
  supports: "off",
  brim: "auto",
  ironing: false,
  seam: "aligned",
  layers: "fixed",
};

/** The thickest layer of the "balanced" choice: the official U1 profiles for this nozzle stop at 0.28 mm. */
const BALANCED_MAX_LAYER = 0.28;

function adaptsLayers(o: PrintOptions) {
  return o.layers === "adaptive" || o.layers === "balanced";
}

export function optionsToOverrides(o: PrintOptions): Record<string, string> {
  return {
    sparse_infill_density: `${Math.max(0, Math.min(100, Math.round(o.infillDensity)))}%`,
    sparse_infill_pattern: o.infillPattern,
    wall_loops: String(Math.max(1, Math.min(6, Math.round(o.wallLoops)))),
    enable_support: o.supports === "off" ? "0" : "1",
    support_type: "tree(auto)",
    support_on_build_plate_only: o.supports === "plate" ? "1" : "0",
    // OrcaSlicer refuses layers of different heights with its default organic trees.
    ...(adaptsLayers(o) && o.supports !== "off" ? { support_style: "tree_hybrid" } : {}),
    brim_type: { none: "no_brim", auto: "auto_brim", always: "outer_only" }[o.brim],
    ironing_type: o.ironing ? "top" : "no ironing",
    seam_position: o.seam,
  };
}

/** How thin and thick adaptive layers may get, from the presets; null for equal layers. */
function layerLimits(o: PrintOptions, process: Preset, machine: Preset): LayerLimits | null {
  if (!adaptsLayers(o)) return null;
  const one = (v: unknown) => Number(Array.isArray(v) ? v[0] : v);
  const base = one(process.layer_height);
  const first = one(process.initial_layer_print_height);
  if (!(base > 0) || !(first > 0)) return null;
  const nozzleMin = one(machine.min_layer_height) || 0.08;
  const nozzleMax = one(machine.max_layer_height) || BALANCED_MAX_LAYER;
  return {
    first,
    base,
    min: Math.min(nozzleMin, base),
    max: o.layers === "balanced" ? Math.max(base, Math.min(nozzleMax, BALANCED_MAX_LAYER)) : base,
  };
}

/** Sets a key, keeping the array shape when the preset stores one value per extruder or flow mode. */
function setKey(preset: Preset, key: string, value: string) {
  const current = preset[key];
  preset[key] = Array.isArray(current) ? current.map(() => value) : value;
}

/** What is loaded in T1..T4. pricePerKg is the spool price in euros per kilo, for cost estimates (default 15). */
export type ToolLoad = { preset: string; color: string; pricePerKg?: number };

export type SliceRequest = {
  input: string; // path to the source 3MF or STL
  workDir: string;
  mode: PrintMode;
  options: PrintOptions;
  tools: ToolLoad[]; // length 4
  /** For each filament slot of the model (0-based), the U1 tool index (0..3). */
  filamentToTool: number[];
  plate?: number; // 0 = all plates
  /** Resize and rotate the plate as one piece. */
  transform?: PlateTransform;
  onLog?: (line: string) => void;
};

export type SliceResult = {
  gcodeFiles: string[];
  exported3mf: string;
  log: string;
  /** Set with adaptive layers: the thinnest and thickest layer in mm, and whether the slicer used them. */
  layers?: { min: number; max: number; applied: boolean };
};

export async function sliceForU1(req: SliceRequest): Promise<SliceResult> {
  fs.mkdirSync(req.workDir, { recursive: true });
  const mode = PRINT_MODES[req.mode];
  const log: string[] = [];
  const onLog = (line: string) => {
    log.push(line);
    req.onLog?.(line);
  };

  const machine = flattenPreset(U1_MACHINE);
  for (const [key, value] of Object.entries(RELIABILITY_MACHINE)) setKey(machine, key, value);
  const process = flattenPreset(mode.process);
  const overrides = { ...RELIABILITY_PROCESS, ...mode.overrides, ...optionsToOverrides(req.options) };
  for (const [key, value] of Object.entries(overrides)) setKey(process, key, value);
  const limits = layerLimits(req.options, process, machine);
  let plan: LayerPlan | null = null;

  // OrcaSlicer prints model filament N with logical tool T(N-1). Each filament gets the preset and colour
  // of the physical toolhead it is mapped to; the printer firmware then redirects T(N-1) to that toolhead
  // (SET_PRINT_EXTRUDER_MAP, sent before the print starts).
  const slotCount = Math.max(1, req.filamentToTool.length);

  const presetDir = path.join(req.workDir, "presets");
  fs.mkdirSync(presetDir, { recursive: true });
  const machinePath = path.join(presetDir, "machine.json");
  const processPath = path.join(presetDir, "process.json");
  fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2));
  fs.writeFileSync(processPath, JSON.stringify(process, null, 2));

  const filamentPaths: string[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const tool = req.tools[req.filamentToTool[slot] ?? 0] ?? req.tools[0];
    const filament = flattenPreset(tool.preset);
    filament.filament_colour = [tool.color];
    const file = path.join(presetDir, `filament_${slot + 1}.json`);
    fs.writeFileSync(file, JSON.stringify(filament, null, 2));
    filamentPaths.push(file);
  }
  const presetArgs = ["--load-settings", `${machinePath};${processPath}`, "--load-filaments", filamentPaths.join(";")];

  const transform = req.transform ?? NO_TRANSFORM;
  let input = req.input;
  const placeArgs: string[] = [];
  if (input.toLowerCase().endsWith(".3mf")) {
    // Step 1: let OrcaSlicer build a complete U1 config (600+ keys) from our presets.
    onLog("Building the full U1 configuration");
    const probe = path.join(presetDir, "probe.stl");
    fs.writeFileSync(probe, cubeStl(10));
    const fullConfigPath = path.join(presetDir, "full_config.json");
    await run(SLICER_BIN, [...presetArgs, "--export-settings", fullConfigPath, probe], req.workDir, onLog);
    const fullConfig = JSON.parse(fs.readFileSync(fullConfigPath, "utf8"));
    // Step 2: swap it into the project so no Bambu-only value survives.
    onLog("Replacing the Bambu settings inside the 3MF");
    if (!isIdentity(transform)) onLog(describeTransform(transform));
    input = path.join(req.workDir, "u1-project.3mf");
    plan = await replaceProjectSettings(req.input, input, fullConfig, { plate: req.plate ?? 0, transform, layers: limits ?? undefined });
  } else {
    // A plain mesh is placed here, as the preview shows it: OrcaSlicer's --scale and --rotate fail on
    // meshes, and its arrange step turns them. Arrange is then turned off below.
    if (!isIdentity(transform)) onLog(describeTransform(transform));
    const placed = writeTransformedStl(parseStl(fs.readFileSync(req.input)), transform.scale, transform.rotation, transform.orient);
    if (limits) {
      // A height profile only travels in a 3MF, so the placed mesh is wrapped in one.
      const wrapped = await addLayerHeights(await stlTo3mf(parseStl(placed), "model"), 0, limits);
      plan = wrapped.plan;
      input = path.join(req.workDir, "u1-model.3mf");
      fs.writeFileSync(input, wrapped.file);
    } else {
      input = path.join(req.workDir, "u1-model.stl");
      fs.writeFileSync(input, placed);
    }
    placeArgs.push("--arrange=0");
  }
  if (plan) onLog(`Adaptive layers: ${plan.min.toFixed(2)} to ${plan.max.toFixed(2)} mm, ${plan.layers.length} layers instead of ${plan.fixedCount}`);

  const outDir = path.join(req.workDir, "out");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const exportName = "u1.gcode.3mf";

  onLog("Slicing");
  const args = [
    ...presetArgs,
    "--allow-newer-file",
    ...placeArgs,
    "--slice", String(req.plate ?? 0),
    "--outputdir", outDir,
    "--export-3mf", exportName,
    input,
  ];
  await run(SLICER_BIN, args, req.workDir, onLog);
  const gcodeFiles = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".gcode"))
    .map((f) => path.join(outDir, f))
    .sort();
  if (gcodeFiles.length === 0) {
    throw new Error(`The slicer produced no G-code.\n${log.slice(-30).join("\n")}`);
  }
  let layers: SliceResult["layers"];
  if (plan) {
    layers = { min: plan.min, max: plan.max, applied: layersApplied(gcodeFiles[0], plan) };
    if (!layers.applied) onLog("The slicer did not use the adaptive layers: this print has equal layers.");
  }
  return { gcodeFiles, exported3mf: path.join(outDir, exportName), log: log.join("\n"), layers };
}

function describeTransform(t: PlateTransform) {
  const turned = isNoOrient(t.orient) ? "" : ", laid on a new side";
  return `Resizing to ${Math.round(t.scale * 100)}% and rotating ${t.rotation}°${turned}`;
}

/** A small ASCII STL cube, used to make OrcaSlicer export its full config. */
function cubeStl(size: number) {
  const v = [
    [0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0],
    [0, 0, size], [size, 0, size], [size, size, size], [0, size, size],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  const body = faces
    .map(([a, b, c]) => `facet normal 0 0 0\nouter loop\nvertex ${v[a].join(" ")}\nvertex ${v[b].join(" ")}\nvertex ${v[c].join(" ")}\nendloop\nendfacet`)
    .join("\n");
  return `solid cube\n${body}\nendsolid cube\n`;
}

/** Exit codes from OrcaSlicer's CLI, translated for people. */
const CLI_ERRORS: Record<number, string> = {
  [-2]: "Invalid parameters were passed to the slicer.",
  [-3]: "The input file was not found.",
  [-5]: "A preset file could not be read.",
  [-6]: "The model file could not be read.",
  [-17]: "The process preset does not fit the printer.",
  [-18]: "The 3MF contains invalid setting values.",
  [-20]: "The model is bigger than the U1 build plate.",
  [-21]: "The objects could not be arranged on the plate.",
  [-24]: "This 3MF was made with an unsupported slicer version.",
  [-50]: "A plate is empty, or an object is not fully inside the build plate.",
  [-51]: "Some slicing settings are invalid for this model.",
  [-52]: "Some objects stick out of the build plate.",
  [-62]: "The filaments used need very different temperatures.",
  [-64]: "Objects collide on the plate.",
  [-66]: "Some filaments cannot be mapped to the U1 toolheads.",
  [-67]: "Only one TPU filament can be used per print.",
  [-100]: "The slicer failed on this model.",
  [-101]: "Toolpaths conflict after slicing. Moving the prime tower may help.",
};

export class SlicerError extends Error {}

function run(bin: string, args: string[], cwd: string, onLog?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd });
    let output = "";
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (onLog) for (const line of text.split("\n")) if (line.trim()) onLog(line);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new SlicerError(`Could not start the slicer at ${bin}: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(output);
      const signed = code === null ? null : code > 127 ? code - 256 : code;
      const reason = signal
        ? `The slicer crashed (${signal}).`
        : (signed !== null && CLI_ERRORS[signed]) || `The slicer stopped with code ${signed}.`;
      const detail = output.split("\n").filter((l) => /error|not in range|failed/i.test(l)).slice(-5).join("\n");
      reject(new SlicerError(detail ? `${reason}\n${detail}` : reason));
    });
  });
}

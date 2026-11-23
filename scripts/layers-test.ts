// Slices a 3MF or STL for the U1 with a layer choice (fixed, adaptive, balanced) and reports the layers of the G-code.
// Run: node --experimental-strip-types scripts/layers-test.ts <file.3mf|stl> <workdir> [layers] [mode] [plate] [supports] [slots] [size %] [side]
// "side" as the last argument tips the model a quarter turn onto its side first.
// Exits with 1 when adaptive layers were asked for and the slicer did not use them.
import fs from "node:fs";
import { sliceForU1, DEFAULT_OPTIONS, type PrintMode, type PrintOptions } from "../src/lib/slicer.ts";
import { tilt } from "../src/lib/orient.ts";

const [input, workDir, layersArg, modeArg, plateArg, supportsArg, slotsArg, sizeArg, tipArg] = process.argv.slice(2);
const slots = Number(slotsArg ?? 1);
const tool = { preset: "Snapmaker PLA SnapSpeed @U1", color: "#FFFFFF" };
const options: PrintOptions = {
  ...DEFAULT_OPTIONS,
  layers: (layersArg ?? "adaptive") as PrintOptions["layers"],
  supports: (supportsArg ?? "off") as PrintOptions["supports"],
};
const started = Date.now();
const result = await sliceForU1({
  input,
  workDir,
  mode: (modeArg ?? "fine") as PrintMode,
  options,
  tools: [tool, { ...tool, color: "#000000" }, { ...tool, color: "#C62D2D" }, { ...tool, color: "#1C8C8C" }],
  filamentToTool: Array.from({ length: slots }, (_, i) => i % 4),
  plate: Number(plateArg ?? 0),
  transform: { scale: Number(sizeArg ?? 100) / 100, rotation: 0, orient: tipArg === "side" ? tilt("y", 90) : undefined },
  onLog: (line) => {
    if (/^(Adaptive layers|The slicer did not)/.test(line)) console.log(line);
  },
});

const text = fs.readFileSync(result.gcodeFiles[0], "utf8");
const zs = [...text.matchAll(/^;Z:([\d.]+)/gm)].map((m) => Number(m[1]));
const steps = new Map<string, number>();
zs.forEach((z, i) => {
  const step = (z - (zs[i - 1] ?? 0)).toFixed(2);
  steps.set(step, (steps.get(step) ?? 0) + 1);
});
const summary = (key: string) => new RegExp(`^; ${key} *[=:] *(.+)$`, "m").exec(text)?.[1] ?? "?";
console.log("options", options.layers, modeArg ?? "fine", "supports", options.supports, "| slice seconds", (Date.now() - started) / 1000);
console.log("layers", zs.length, "top", zs[zs.length - 1], "| time", summary("estimated printing time \\(normal mode\\)"), "| filament g", summary("total filament used \\[g\\]"));
console.log("layer steps (mm: count)", Object.fromEntries([...steps].sort((a, b) => Number(a[0]) - Number(b[0]))));
console.log("tool changes", (text.match(/^T[0-3]\s*$/gm) ?? []).length, "| result.layers", result.layers);
if (options.layers !== "fixed" && !result.layers?.applied) process.exit(1);

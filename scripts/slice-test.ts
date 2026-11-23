// Slices a 3MF for the U1 with default options and prints the result.
// Run: node --experimental-strip-types scripts/slice-test.ts <file.3mf> <workdir> [slots] [mode] [plate]
import { sliceForU1, DEFAULT_OPTIONS, type PrintMode } from "../src/lib/slicer.ts";

const [input, workDir, slotsArg, modeArg, plateArg] = process.argv.slice(2);
const slots = Number(slotsArg ?? 1);
const tools = [
  { preset: "Snapmaker PLA SnapSpeed @U1", color: "#FFFFFF" },
  { preset: "Snapmaker PLA SnapSpeed @U1", color: "#000000" },
  { preset: "Snapmaker PLA SnapSpeed @U1", color: "#C62D2D" },
  { preset: "Snapmaker PLA SnapSpeed @U1", color: "#1C8C8C" },
];
const started = Date.now();
const result = await sliceForU1({
  input,
  workDir,
  mode: (modeArg ?? "fast") as PrintMode,
  options: DEFAULT_OPTIONS,
  tools,
  filamentToTool: Array.from({ length: slots }, (_, i) => i % 4),
  plate: Number(plateArg ?? 0),
});
console.log("seconds", (Date.now() - started) / 1000);
console.log(result.gcodeFiles, result.exported3mf);

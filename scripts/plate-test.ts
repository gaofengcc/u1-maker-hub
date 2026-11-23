// Packs several plates of one downloaded 3MF onto U1 plates and slices each one.
// Run: node --experimental-strip-types scripts/plate-test.ts <file.3mf> <workdir> <plates, e.g. 1,2,3> [copies] [size%]
import path from "node:path";
import { combineProjects } from "../src/lib/combine.ts";
import { sliceForU1, DEFAULT_OPTIONS } from "../src/lib/slicer.ts";

const [file, workDir, platesArg, copiesArg, sizeArg] = process.argv.slice(2);
const tool = { preset: "Snapmaker PLA SnapSpeed @U1", color: "#FFFFFF" };
const sources = platesArg.split(",").map((p) => ({
  file,
  plate: Number(p),
  transform: { scale: Number(sizeArg ?? 100) / 100, rotation: 0 },
  copies: Number(copiesArg ?? 1),
  filamentToTool: [0],
  title: `plate ${p}`,
}));
const { files, copies } = await combineProjects(sources, path.join(workDir, "plates"));
console.log(`${copies} objects on ${files.length} U1 plate(s)`);
for (const [i, input] of files.entries()) {
  const started = Date.now();
  const r = await sliceForU1({ input, workDir: path.join(workDir, `slice-${i + 1}`), mode: "fast", options: DEFAULT_OPTIONS, tools: [tool, tool, tool, tool], filamentToTool: [0, 1, 2, 3], plate: 1 });
  console.log(`plate ${i + 1}: ${(Date.now() - started) / 1000}s`, r.gcodeFiles);
}

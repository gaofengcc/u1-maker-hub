import path from "node:path";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { readJson } from "@/lib/http.ts";
import { buildGroupProject, arrangeGroup, generateFullU1Config, groupByPalette, readArrangeProject, sliceAllPlates } from "@/lib/arrange.ts";
import { readProject } from "@/lib/threemf.ts";
import { DATA_DIR } from "@/lib/store.ts";
import { createArrangeJob, saveArrangeJob, type ArrangeJob, type ArrangeGroupResult } from "@/lib/arrangeJobs.ts";
const ROOT = path.join(DATA_DIR, "arrange");


export async function POST(req: Request) {
  const body = await readJson<{ instanceId?: number; designId?: number; mode?: "palette" }>(req);
  if (!Number.isInteger(body.instanceId) || (body.instanceId ?? 0) <= 0 || !Number.isInteger(body.designId) || (body.designId ?? 0) <= 0) {
    return NextResponse.json({ error: "请选择有效的模型配置。" }, { status: 400 });
  }
  if (body.mode && body.mode !== "palette") return NextResponse.json({ error: "不支持的摆盘模式。" }, { status: 400 });
  const instanceId = body.instanceId as number;
  const job = createArrangeJob();
  void run(job, instanceId, body.designId as number);
  return NextResponse.json(job, { status: 201 });
}

async function run(job: ArrangeJob, instanceId: number, _designId: number) {
  const dir = path.join(ROOT, job.id);
  try {
    job.status = "running"; saveArrangeJob(job);
    const source = (await downloadInstance(instanceId)).file;
    const project = await readArrangeProject(source);
    const groups = groupByPalette(project);
    const configs = new Map<string, { fullConfig: Record<string, unknown>; loadSettings: string; loadFilaments: string }>();
    const out: ArrangeGroupResult[] = [];
    for (let i = 0; i < groups.length; i++) {
      const palette = groups[i];
      let config = configs.get(palette.material);
      if (!config) {
        const configDir = path.join(dir, "config", palette.material);
        const fullConfig = await generateFullU1Config(configDir, palette.material);
        const presetDir = path.join(configDir, "presets");
        config = { fullConfig, loadSettings: `${path.join(presetDir, "machine.json")};${path.join(presetDir, "process.json")}`, loadFilaments: [1, 2, 3, 4].map((n) => path.join(presetDir, `filament_${n}.json`)).join(";") };
        configs.set(palette.material, config);
      }
      const groupPalette = { ...palette, fullConfig: config.fullConfig };
      const groupDir = path.join(dir, `group-${i + 1}`);
      const input = path.join(groupDir, "group.3mf");
      await buildGroupProject(source, groupPalette, input);
      const arranged = await arrangeGroup(input, { outputDir: path.join(groupDir, "arranged"), exportName: "arranged.3mf", loadSettings: config.loadSettings, loadFilaments: config.loadFilaments });
      fs.copyFileSync(arranged.file, path.join(dir, `group-${i + 1}.3mf`));
      const plates = await sliceAllPlates(arranged.file, { outputDir: path.join(groupDir, "sliced"), loadSettings: config.loadSettings, loadFilaments: config.loadFilaments });
      const failed = plates.find((plate) => plate.exitCode !== 0);
      if (failed) throw new Error(`第 ${i + 1} 组第 ${failed.plate} 盘切片失败（退出码 ${failed.exitCode}）。`);
      out.push({ index: i + 1, colors: palette.colors, parts: palette.parts, plates: plates.length, gramsPerPlate: plates.map((p) => p.grams ?? 0), minutesPerPlate: plates.map((p) => p.minutes ?? 0) });
      job.progress = Math.round(((i + 1) / groups.length) * 100); saveArrangeJob(job);
    }
    const info = await readProject(source);
    job.result = { groups: out, totalPlates: out.reduce((n, g) => n + g.plates, 0), originalPlates: info.plates.length, spoolChanges: out.length, keptParts: out.reduce((n, g) => n + g.parts, 0), originalParts: project.parts.length };
    job.progress = 100; job.status = "done"; saveArrangeJob(job);
  } catch (err) {
    job.status = "error"; job.error = err instanceof Error ? err.message : String(err); saveArrangeJob(job);
  }
}

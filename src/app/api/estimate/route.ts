import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { eachTriangle, itemsOnPlate, loadProject } from "@/lib/geometry.ts";
import { readProject, plateFilaments } from "@/lib/threemf.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, sliceForU1, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import { metricsFromTriangles, roughEstimate, type Triangle } from "@/lib/recommend.ts";
import { DATA_DIR, readSettings } from "@/lib/store.ts";
import { readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

const CACHE_FILE = path.join(DATA_DIR, "slice-estimates.json");
const ERROR_NOTE = "粗估的主要误差项：支撑体积、多色换料、加速度限制、小特征减速。";

type EstimateBody = {
  instanceId?: number;
  plate?: number;
  mode?: string;
  options?: Partial<PrintOptions>;
  exact?: boolean;
  site?: string;
};

type Estimate = { seconds: number | null; grams: number | null; errorNote?: string };

/** 预计时间和耗材。exact=false 只做几何计算，exact=true 使用 U1 OrcaSlicer 真切。 */
export async function POST(req: NextRequest) {
  const body = await readJson<EstimateBody>(req);
  const instanceId = Number(body.instanceId);
  const plate = Math.max(0, Math.round(Number(body.plate ?? 1)) || 0);
  const mode = body.mode as PrintMode;
  if (!Number.isInteger(instanceId) || instanceId <= 0) return NextResponse.json({ error: "模型编号无效。" }, { status: 400 });
  if (typeof mode !== "string" || !(mode in PRINT_MODES)) return NextResponse.json({ error: "切片档位无效。" }, { status: 400 });
  const options = normalizeOptions(body.options);
  try {
    const site = resolveSite(body.site ?? req.nextUrl.searchParams.get("site"));
    const { file } = await downloadInstance(instanceId, site);
    const [project, info] = await Promise.all([loadProject(file), readProject(file)]);
    const triangles: Triangle[] = [];
    for (const item of itemsOnPlate(project, plate)) eachTriangle(project, item, (triangle) => triangles.push(triangle));
    const metrics = metricsFromTriangles(triangles);
    const material = info.filaments[0]?.type ?? "PLA";
    const rough = roughEstimate(metrics, options, material, Math.max(0, info.filaments.length - 1));
    if (!body.exact) {
      return NextResponse.json({ exact: false, cached: false, estimate: rough, seconds: rough.seconds, grams: rough.grams, errorNote: ERROR_NOTE });
    }

    const hash = parameterHash(instanceId, plate, mode, options);
    const cached = readCache()[hash];
    if (cached) return NextResponse.json({ exact: true, cached: true, ...cached });

    const settings = readSettings();
    const slotCount = Math.max(1, info.filaments.length);
    const mapping = Array.from({ length: slotCount }, (_, i) => i % 4);
    const used = await plateFilaments(file, plate);
    // 使用作者材料类别生成 U1 料槽，仍由现有切片链路负责可靠性保护参数。
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "u1-estimate-"));
    try {
      const result = await sliceForU1({
        input: file,
        workDir,
        mode,
        options,
        tools: settings.tools,
        filamentToTool: mapping,
        filamentTypes: info.filaments.map((f) => f.type),
        plate,
      });
      const stats = result.gcodeFiles.map(readGcodeStats);
      const exactResult: Estimate = {
        seconds: stats.every((s) => s.seconds != null) ? stats.reduce((n, s) => n + (s.seconds ?? 0), 0) : null,
        grams: stats.every((s) => s.grams != null) ? stats.reduce((n, s) => n + (s.grams ?? 0), 0) : null,
      };
      writeCache(hash, exactResult);
      return NextResponse.json({ exact: true, cached: false, ...exactResult, filamentSlots: used.length });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ exact: Boolean(body.exact), cached: false, error: message }, { status: 500 });
  }
}

function normalizeOptions(input: Partial<PrintOptions> | undefined): PrintOptions {
  const o = { ...DEFAULT_OPTIONS, ...(input ?? {}) } as PrintOptions;
  return {
    infillDensity: Number.isFinite(Number(o.infillDensity)) ? Number(o.infillDensity) : DEFAULT_OPTIONS.infillDensity,
    infillPattern: ["gyroid", "grid", "crosshatch", "cubic", "lightning", "honeycomb"].includes(o.infillPattern) ? o.infillPattern : DEFAULT_OPTIONS.infillPattern,
    wallLoops: Number.isFinite(Number(o.wallLoops)) ? Number(o.wallLoops) : DEFAULT_OPTIONS.wallLoops,
    supports: ["off", "auto", "plate"].includes(o.supports) ? o.supports : DEFAULT_OPTIONS.supports,
    brim: ["none", "auto", "always"].includes(o.brim) ? o.brim : DEFAULT_OPTIONS.brim,
    ironing: Boolean(o.ironing),
    seam: ["aligned", "back", "nearest", "random"].includes(o.seam) ? o.seam : DEFAULT_OPTIONS.seam,
    layers: ["fixed", "adaptive", "balanced"].includes(o.layers) ? o.layers : DEFAULT_OPTIONS.layers,
  };
}

function parameterHash(instanceId: number, plate: number, mode: PrintMode, options: PrintOptions) {
  return crypto.createHash("sha256").update(JSON.stringify({ instanceId, plate, mode, options })).digest("hex");
}

function readCache(): Record<string, Estimate> {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Record<string, Estimate>; } catch { return {}; }
}

/** 读-改-写后用 rename 原子替换，避免并发请求留下半个 JSON。 */
function writeCache(key: string, value: Estimate) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const next = { ...readCache(), [key]: value };
  const temp = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2));
  fs.renameSync(temp, CACHE_FILE);
}

function readGcodeStats(file: string): Estimate {
  const text = fs.readFileSync(file, "utf8");
  const tail = text.slice(-80000);
  const grams = Number(/(?:total )?filament used \[g\] = ([\d.]+)/i.exec(tail)?.[1] ?? NaN);
  const duration = /estimated printing time \(normal mode\) = ([^\r\n]+)/i.exec(tail)?.[1] ?? "";
  const seconds = parseDuration(duration);
  return { seconds: Number.isFinite(seconds) ? seconds : null, grams: Number.isFinite(grams) ? grams : null };
}

function parseDuration(value: string) {
  let seconds = 0;
  for (const [, n, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) seconds += Number(n) * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[unit.toLowerCase()];
  return value ? seconds : NaN;
}

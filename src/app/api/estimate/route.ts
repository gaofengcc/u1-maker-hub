import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { eachTriangle, itemsOnPlate, loadProject } from "@/lib/geometry.ts";
import { readProject } from "@/lib/threemf.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import { metricsFromTriangles, roughEstimate, type Triangle } from "@/lib/recommend.ts";
import { readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";
import { createSliceTask } from "@/lib/sliceTasks.ts";

const ERROR_NOTE = "粗估的主要误差项：支撑体积、多色换料、加速度限制、小特征减速。";

type EstimateBody = {
  instanceId?: number;
  plate?: number;
  mode?: string;
  options?: Partial<PrintOptions>;
  exact?: boolean;
  site?: string;
  overrides?: Record<string, string>;
};

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
    if (body.exact) {
      const overrides = normalizeOverrides(body.overrides);
      const task = createSliceTask({ instanceId, plate, mode, options, overrides, site });
      return NextResponse.json({ exact: true, ...task }, { status: task.status === "done" ? 200 : 202 });
    }
    const { file } = await downloadInstance(instanceId, site);
    const [project, info] = await Promise.all([loadProject(file), readProject(file)]);
    const triangles: Triangle[] = [];
    for (const item of itemsOnPlate(project, plate)) eachTriangle(project, item, (triangle) => triangles.push(triangle.slice()));
    const metrics = metricsFromTriangles(triangles);
    const material = info.filaments[0]?.type ?? "PLA";
    const rough = roughEstimate(metrics, options, material, Math.max(0, info.filaments.length - 1), PRINT_MODES[mode].layerHeight);
    return NextResponse.json({ exact: false, cached: false, estimate: rough, seconds: rough.seconds, grams: rough.grams, errorNote: ERROR_NOTE });
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

function normalizeOverrides(input: Record<string, string> | undefined) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => /^[a-zA-Z0-9_.-]+$/.test(key) && typeof value === "string").map(([key, value]) => [key, value.slice(0, 200)]));
}

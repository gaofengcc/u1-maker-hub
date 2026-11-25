import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance, getDesign } from "@/lib/makerworld.ts";
import { eachTriangle, itemsOnPlate, loadProject } from "@/lib/geometry.ts";
import { readProject } from "@/lib/threemf.ts";
import { metricsFromTriangles, recommendFromMetrics, type Triangle } from "@/lib/recommend.ts";
import { resolveSite } from "@/lib/sites.ts";
import { extractHints } from "@/lib/modelHints.ts";

/** 返回当前盘几何指标和按模型形状计算的两套 U1 推荐参数。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  const plate = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("plate") ?? 1)) || 0);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "模型编号无效。", creator: null, metrics: null }, { status: 400 });
  try {
    const site = resolveSite(req.nextUrl.searchParams.get("site"));
    const { file } = await downloadInstance(id, site);
    const [project, info, design] = await Promise.all([loadProject(file), readProject(file), getDesign(id, site)]);
    const triangles: Triangle[] = [];
    for (const item of itemsOnPlate(project, plate)) eachTriangle(project, item, (triangle) => triangles.push(triangle.slice()));
    const metrics = metricsFromTriangles(triangles);
    const materialType = info.filaments[0]?.type ?? "PLA";
    const hints = extractHints(design.summary ?? "");
    const presets = recommendFromMetrics(metrics, { materialType, hints });
    const hintConflicts: string[] = [];
    if (hints.supports === "forbidden" && metrics.overhang45Percent >= 12) {
      hintConflicts.push(`几何指标建议开支撑（悬垂 ${metrics.overhang45Percent.toFixed(1)}%），但作者说明禁止支撑 → 已按作者说明关闭`);
    }
    if (hints.supports === "required" && metrics.overhang45Percent < 12) {
      hintConflicts.push(`几何指标未建议开支撑（悬垂 ${metrics.overhang45Percent.toFixed(1)}%），但作者说明要求支撑 → 已按作者说明开启`);
    }
    return NextResponse.json({ creator: info.creator, metrics, presets, hints, hintConflicts, plateCount: info.plates.length || 1, objectOverrides: info.objectOverrides });
  } catch (err) {
    // 推荐面板可在下载失败时继续显示其它档位，故返回明确错误而不是 500。
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ creator: null, metrics: null, presets: null, plateCount: 0, error: `无法读取模型几何：${message}` }, { status: 200 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { eachTriangle, itemsOnPlate, loadProject } from "@/lib/geometry.ts";
import { readProject } from "@/lib/threemf.ts";
import { metricsFromTriangles, recommendFromMetrics, type Triangle } from "@/lib/recommend.ts";
import { errorResponse } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

/** 返回当前盘几何指标和按模型形状计算的两套 U1 推荐参数。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  const plate = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("plate") ?? 1)) || 0);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "模型编号无效。", creator: null, metrics: null }, { status: 400 });
  try {
    const site = resolveSite(req.nextUrl.searchParams.get("site"));
    const { file } = await downloadInstance(id, site);
    const [project, info] = await Promise.all([loadProject(file), readProject(file)]);
    const triangles: Triangle[] = [];
    for (const item of itemsOnPlate(project, plate)) eachTriangle(project, item, (triangle) => triangles.push(triangle));
    const metrics = metricsFromTriangles(triangles);
    const materialType = info.filaments[0]?.type ?? "PLA";
    const presets = recommendFromMetrics(metrics, { materialType });
    return NextResponse.json({ creator: info.creator, metrics, presets, plateCount: info.plates.length || 1, objectOverrides: info.objectOverrides });
  } catch (err) {
    // 推荐面板可在下载失败时继续显示其它档位，故返回明确错误而不是 500。
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ creator: null, metrics: null, presets: null, plateCount: 0, error: `无法读取模型几何：${message}` }, { status: 200 });
  }
}

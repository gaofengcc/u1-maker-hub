import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance, getDesign } from "@/lib/makerworld.ts";
import { eachTriangle, itemsOnPlate, loadProject } from "@/lib/geometry.ts";
import { readProject } from "@/lib/threemf.ts";
import { metricsFromTriangles, recommendFromMetrics, type Triangle } from "@/lib/recommend.ts";
import { resolveSite } from "@/lib/sites.ts";
import { extractHints } from "@/lib/modelHints.ts";
import { mergeHints, parseHintsWithAI } from "@/lib/aiHints.ts";

/** 返回当前盘几何指标和按模型形状计算的两套 U1 推荐参数。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  const plate = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("plate") ?? 1)) || 0);
  const designParam = Math.round(Number(req.nextUrl.searchParams.get("design") ?? 0)) || 0;
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "模型编号无效。", creator: null, metrics: null }, { status: 400 });
  try {
    const site = resolveSite(req.nextUrl.searchParams.get("site"));
    const { file } = await downloadInstance(id, site);
    // 说明必须按「设计 id」取。配置 id 与设计 id 是两套编号且会撞号
    // （实例 2600505 属于设计 2303103，但 /design/2600505 是另一个模型），
    // 拿配置 id 直接查说明会把别的模型的作者提示读进来。
    const designId = designParam > 0 ? designParam : id;
    const [project, info, design] = await Promise.all([loadProject(file), readProject(file), getDesign(designId, site)]);
    const belongsToDesign = !design.instances?.length || design.instances.some((instance) => Number(instance.id) === id);
    const triangles: Triangle[] = [];
    for (const item of itemsOnPlate(project, plate)) eachTriangle(project, item, (triangle) => triangles.push(triangle.slice()));
    const metrics = metricsFromTriangles(triangles);
    const materialType = info.filaments[0]?.type ?? "PLA";
    // 正则层先给出确定性结果；AI 解析（命中缓存则零延迟）再补充语义理解。
    // 任何失败都静默降级到正则，`?ai=0` 可强制只走正则。
    // 配置不属于这个设计时，宁可不给提示，也不能用错模型的说明。
    const summary = belongsToDesign ? design.summary ?? "" : "";
    const ruleHints = extractHints(summary);
    const aiHints = req.nextUrl.searchParams.get("ai") === "0" ? null : await parseHintsWithAI(summary);
    const { hints, source: hintsSource } = mergeHints(ruleHints, aiHints);
    const presets = recommendFromMetrics(metrics, { materialType, hints });
    const hintConflicts: string[] = [];
    if (!belongsToDesign) {
      hintConflicts.push(designParam > 0
        ? `配置 ${id} 不属于设计 ${designId}，已跳过作者说明解析（避免误用其它模型的说明）`
        : `未提供设计 id，已跳过作者说明解析（配置 id 与设计 id 会撞号，可能读到别的模型）`);
    }
    if (hints.supports === "forbidden" && metrics.overhang45Percent >= 12) {
      hintConflicts.push(`几何指标建议开支撑（悬垂 ${metrics.overhang45Percent.toFixed(1)}%），但作者说明禁止支撑 → 已按作者说明关闭`);
    }
    if (hints.supports === "required" && metrics.overhang45Percent < 12) {
      hintConflicts.push(`几何指标未建议开支撑（悬垂 ${metrics.overhang45Percent.toFixed(1)}%），但作者说明要求支撑 → 已按作者说明开启`);
    }
    return NextResponse.json({ creator: info.creator, metrics, presets, hints, hintsSource, hintConflicts, plateCount: info.plates.length || 1, objectOverrides: info.objectOverrides });
  } catch (err) {
    // 推荐面板可在下载失败时继续显示其它档位，故返回明确错误而不是 500。
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ creator: null, metrics: null, presets: null, plateCount: 0, error: `无法读取模型几何：${message}` }, { status: 200 });
  }
}

import { readFileSync } from "node:fs";
import { metricsFromTriangles, recommendFromMetrics } from "../src/lib/recommend.ts";
import { extractHints } from "../src/lib/modelHints.ts";
import { optionsToOverrides, DEFAULT_OPTIONS, type PrintOptions } from "../src/lib/slicer.ts";
import type { Triangle } from "../src/lib/recommend.ts";

function cube(size: number): Triangle[] {
  const v = [[0,0,0],[size,0,0],[size,size,0],[0,size,0],[0,0,size],[size,0,size],[size,size,size],[0,size,size]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.map(([a,b,c]) => [...v[a], ...v[b], ...v[c]] as unknown as Triangle);
}


function metricWithOverhang(overhang45Percent: number, overhang60Percent = 0): Parameters<typeof recommendFromMetrics>[0] {
  return {
    bbox: [0, 0, 0, 20, 20, 20], volumeMm3: 8000, surfaceAreaMm2: 2400,
    overhang45Percent, overhang60Percent, flatOverhangMm2: 0, bedContactAreaMm2: 400, heightMm: 20,
    baseAreaMm2: 400, heightToBaseRatio: 1, thinFeatureScore: 0, triangleCount: 12,
  };
}

const severeRec = recommendFromMetrics(metricWithOverhang(30, 10));
if (severeRec.recommend.overrides.support_threshold_angle !== "35") throw new Error("严重悬垂支撑角应为35");
const moderateRec = recommendFromMetrics(metricWithOverhang(18));
if (moderateRec.recommend.overrides.support_threshold_angle !== "40") throw new Error("中等悬垂支撑角应为40");
const lowRec = recommendFromMetrics(metricWithOverhang(5));
if (lowRec.recommend.overrides.support_threshold_angle !== "45") throw new Error("轻微悬垂支撑角应为45");
if (recommendFromMetrics(metricWithOverhang(5), { materialType: "PETG" }).recommend.overrides.support_top_z_distance !== "0.25") throw new Error("PETG支撑间隙应为0.25");
if (recommendFromMetrics(metricWithOverhang(5), { materialType: "PLA" }).recommend.overrides.support_top_z_distance !== "0.2") throw new Error("PLA支撑间隙应为0.2");
const baseOptions: PrintOptions = { ...DEFAULT_OPTIONS, supports: "off" };
const slowOverrides = optionsToOverrides({ ...baseOptions, overhangSpeed: "slow" });
if (slowOverrides.overhang_2_4_speed !== "40" || slowOverrides.overhang_3_4_speed !== "25" || slowOverrides.overhang_4_4_speed !== "10") throw new Error("slow悬垂降速映射错误");
if ("overhang_totally_speed" in slowOverrides) throw new Error("overhang_totally_speed 是 Snapmaker 私有键，上游切片器会丢弃，不应下发");
// 大平悬空 → 桥接降速；小面积 → 不下发
const roofMetrics = metricWithOverhang(20);
roofMetrics.flatOverhangMm2 = 3300;
const roofRec = recommendFromMetrics(roofMetrics);
if (roofRec.recommend.overrides.bridge_speed !== "35") throw new Error("大平悬空应把桥接速度降到 35");
if (recommendFromMetrics(metricWithOverhang(20)).recommend.overrides.bridge_speed !== undefined) throw new Error("平悬空小时不应改桥接速度");
const autoOverrides = optionsToOverrides({ ...baseOptions, overhangSpeed: "auto" });
if (Object.keys(autoOverrides).some((key) => key.startsWith("overhang_"))) throw new Error("auto不应覆盖悬垂降速");

const box = metricsFromTriangles(cube(20));
if (Math.abs(box.volumeMm3 - 8000) > 1e-6) throw new Error(`立方体体积错误 ${box.volumeMm3}`);
if (Math.abs(box.surfaceAreaMm2 - 2400) > 1e-6) throw new Error(`立方体表面积错误 ${box.surfaceAreaMm2}`);
if (box.overhang45Percent !== 0) throw new Error(`立方体悬垂错误 ${box.overhang45Percent}`);
if (Math.abs(box.bedContactAreaMm2 - 400) > 1e-6) throw new Error(`贴床面积错误 ${box.bedContactAreaMm2}`);

// 复用同一数组的迭代器必须与深拷贝后的三角面得到完全相同的指标。
const reused = new Array<number>(9);
const source: Triangle[] = cube(20).slice(0, 4);
const reusedMetrics = metricsFromTriangles((function* () {
  for (const triangle of source) {
    reused.splice(0, 9, ...triangle);
    yield reused;
  }
})());
const copiedMetrics = metricsFromTriangles(source.map((triangle) => [...triangle]));
if (JSON.stringify(reusedMetrics) !== JSON.stringify(copiedMetrics)) throw new Error("复用三角面数组导致指标不一致");

// 45° 斜面在阈值边界按不计入处理。
const slope45: Triangle = [0, 0, 10, 0, 20, -10, 20, 0, 10];
const slope = metricsFromTriangles([slope45]);
if (slope.overhang45Percent !== 0) throw new Error(`45° 边界斜面不应计入悬垂 ${slope.overhang45Percent}`);

// 中腰水平朝下面属于悬垂，z=minZ 的水平朝下面属于贴床面。
const middleDown: Triangle = [0, 0, 5, 0, 20, 5, 20, 0, 5];
const bedDown: Triangle = [0, 0, 0, 0, 20, 0, 20, 0, 0];
const horizontal = metricsFromTriangles([middleDown, bedDown]);
if (!(horizontal.overhang45Percent > 0)) throw new Error(`中腰水平朝下面未计入悬垂 ${horizontal.overhang45Percent}`);
const bedOnly = metricsFromTriangles([bedDown]);
if (bedOnly.overhang45Percent !== 0) throw new Error(`最低处水平朝下面不应计入悬垂 ${bedOnly.overhang45Percent}`);
if (bedOnly.bedContactAreaMm2 <= 0) throw new Error(`最低处水平朝下面未识别贴床面 ${bedOnly.bedContactAreaMm2}`);
const expectedArea = Math.hypot(20, 20) * 20 / 2;
if (Math.abs(slope.surfaceAreaMm2 - expectedArea) > 1e-6) throw new Error("斜面面积不一致");

const tall = metricsFromTriangles(cube(20).map((t) => {
  const out = [...t] as number[];
  for (let i = 2; i < 9; i += 3) out[i] *= 7.5;
  return out as unknown as Triangle;
}));
const flat = box;
const tallRec = recommendFromMetrics(tall);
const flatRec = recommendFromMetrics(flat);
if (tallRec.recommend.options.brim === flatRec.recommend.options.brim) throw new Error("细高件与扁大件 brim 未区分");
if (tallRec.recommend.overrides.outer_wall_speed === flatRec.recommend.overrides.outer_wall_speed) throw new Error("细高件与扁大件速度未区分");
if (tallRec.recommend.options.wallLoops === flatRec.recommend.options.wallLoops) throw new Error("细高件与扁大件墙数未区分");

// 作者说明解析与优先级覆盖。
const realSummary = `<p>推荐设置</p><ul><li>层高：0.16mm 或 0.20mm（以获得最大保真度）</li><li>填充：10-15%</li><li>支撑：🚫 禁止！目的是测试打印机的极限</li><li>材料：适用于 PLA、PETG 或 ABS</li></ul>`;
const realHints = extractHints(realSummary);
if (realHints.supports !== "forbidden") throw new Error("真实说明应识别为禁止支撑");
if (realHints.layerHeight?.min !== 0.16 || realHints.layerHeight?.max !== 0.2) throw new Error("真实说明层高范围错误");
if (realHints.infill?.min !== 10 || realHints.infill?.max !== 15) throw new Error("真实说明填充范围错误");
if (!realHints.materials?.includes("PLA")) throw new Error("真实说明材料未识别 PLA");
if (!realHints.quotes.some((quote) => quote.sentence.includes("支撑") && quote.sentence.includes("禁止"))) throw new Error("真实说明未保留禁止支撑原句");

const englishHints = extractHints("Layer height: 0.2mm. Infill 15%. No supports needed.");
if (englishHints.supports !== "forbidden") throw new Error("英文说明应识别为禁止支撑");
if (englishHints.layerHeight?.min !== 0.2 || englishHints.layerHeight?.max !== 0.2) throw new Error("英文说明层高错误");
if (englishHints.infill?.min !== 15 || englishHints.infill?.max !== 15) throw new Error("英文说明填充错误");

if (extractHints("需要支撑").supports !== "required") throw new Error("需要支撑应识别为必需");
if (extractHints("谢谢下载").quotes.length !== 0) throw new Error("无关说明不应产生命中");

const forbiddenHints = extractHints("支撑：🚫 禁止");
const forcedOff = recommendFromMetrics(metricWithOverhang(40), { hints: forbiddenHints });
if (forcedOff.recommend.options.supports !== "off" || forcedOff.speed.options.supports !== "off") throw new Error("作者禁止支撑时两档都应关闭");
if (!forcedOff.recommend.reasons.some((reason) => reason.includes("作者说明"))) throw new Error("支撑覆盖理由应引用作者说明");

const rangedHints = extractHints("层高：0.16mm 或 0.20mm。填充：10-15%");
const rangedRec = recommendFromMetrics(metricWithOverhang(5), { hints: rangedHints });
if (rangedRec.recommend.overrides.layer_height !== "0.16") throw new Error("推荐档层高未夹到0.16");
if (rangedRec.speed.overrides.layer_height !== "0.20") throw new Error("最快档层高应保持0.20");
if (rangedRec.recommend.options.infillDensity !== 15) throw new Error("推荐档填充未夹到15");
if (rangedRec.speed.options.infillDensity !== 12) throw new Error("最快档填充应保持区间内12");
// ---- 真实语料回归（scripts/fixtures/model-hints.json，原文照抄公开说明）----
// 这 5 条是线上真实模型的说明，覆盖过 5 类误判：材料语境、用量语境、无祈使前缀、
// 数字被邻近参数抢走（0.16 底层高度 / 0.48 最小深度）。
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/model-hints.json", import.meta.url), "utf8"),
) as Record<string, any>;
let fixtureCount = 0;
for (const [id, fx] of Object.entries(fixtures)) {
  if (id.startsWith("_")) continue;
  const h = extractHints(fx.html);
  const e = fx.expect ?? {};
  if (e.supports && h.supports !== e.supports) throw new Error(`${id} supports 应为 ${e.supports}，实际 ${h.supports}`);
  if (e.noSupports && h.supports !== undefined) throw new Error(`${id} 不应判定支撑，实际 ${h.supports}`);
  if (e.brim && h.brim !== e.brim) throw new Error(`${id} brim 应为 ${e.brim}，实际 ${h.brim}`);
  if (e.noHints && h.quotes.length > 0) throw new Error(`${id} 不应有任何提示，实际 ${h.quotes.length} 条`);
  if (e.layerMin !== undefined && h.layerHeight?.min !== e.layerMin) throw new Error(`${id} 层高下限应为 ${e.layerMin}，实际 ${h.layerHeight?.min}`);
  if (e.layerMax !== undefined && h.layerHeight?.max !== e.layerMax) throw new Error(`${id} 层高上限应为 ${e.layerMax}，实际 ${h.layerHeight?.max}`);
  if (e.infillMin !== undefined && h.infill?.min !== e.infillMin) throw new Error(`${id} 填充下限应为 ${e.infillMin}，实际 ${h.infill?.min}`);
  if (e.infillMax !== undefined && h.infill?.max !== e.infillMax) throw new Error(`${id} 填充上限应为 ${e.infillMax}，实际 ${h.infill?.max}`);
  if (e.material && !(h.materials ?? []).includes(e.material)) throw new Error(`${id} 应识别材料 ${e.material}`);
  fixtureCount++;
}
console.log(`真实语料回归 ${fixtureCount} 条全过`);
console.log("verify-recommend: PASS");
console.log(`cube volume=${box.volumeMm3} surface=${box.surfaceAreaMm2} overhang45=${box.overhang45Percent}% bed=${box.bedContactAreaMm2}`);
console.log(`slope45 overhang45=${slope.overhang45Percent.toFixed(2)}% area=${slope.surfaceAreaMm2.toFixed(2)}`);
console.log(`horizontal overhang45=${horizontal.overhang45Percent.toFixed(2)}% bed=${bedOnly.bedContactAreaMm2.toFixed(2)}`);
console.log(`tall brim=${tallRec.recommend.options.brim} speed=${tallRec.recommend.overrides.outer_wall_speed} walls=${tallRec.recommend.options.wallLoops}`);
console.log(`flat brim=${flatRec.recommend.options.brim} speed=${flatRec.recommend.overrides.outer_wall_speed} walls=${flatRec.recommend.options.wallLoops}`);

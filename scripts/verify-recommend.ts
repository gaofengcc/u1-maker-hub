import { metricsFromTriangles, recommendFromMetrics } from "../src/lib/recommend.ts";
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
    overhang45Percent, overhang60Percent, bedContactAreaMm2: 400, heightMm: 20,
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
if (slowOverrides.overhang_2_4_speed !== "40" || slowOverrides.overhang_3_4_speed !== "25" || slowOverrides.overhang_4_4_speed !== "10" || slowOverrides.overhang_totally_speed !== "40") throw new Error("slow悬垂降速映射错误");
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
console.log("verify-recommend: PASS");
console.log(`cube volume=${box.volumeMm3} surface=${box.surfaceAreaMm2} overhang45=${box.overhang45Percent}% bed=${box.bedContactAreaMm2}`);
console.log(`slope45 overhang45=${slope.overhang45Percent.toFixed(2)}% area=${slope.surfaceAreaMm2.toFixed(2)}`);
console.log(`horizontal overhang45=${horizontal.overhang45Percent.toFixed(2)}% bed=${bedOnly.bedContactAreaMm2.toFixed(2)}`);
console.log(`tall brim=${tallRec.recommend.options.brim} speed=${tallRec.recommend.overrides.outer_wall_speed} walls=${tallRec.recommend.options.wallLoops}`);
console.log(`flat brim=${flatRec.recommend.options.brim} speed=${flatRec.recommend.overrides.outer_wall_speed} walls=${flatRec.recommend.options.wallLoops}`);

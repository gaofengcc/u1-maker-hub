import { metricsFromTriangles, recommendFromMetrics } from "../src/lib/recommend.ts";
import type { Triangle } from "../src/lib/recommend.ts";

function cube(size: number): Triangle[] {
  const v = [[0,0,0],[size,0,0],[size,size,0],[0,size,0],[0,0,size],[size,0,size],[size,size,size],[0,size,size]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.map(([a,b,c]) => [...v[a], ...v[b], ...v[c]] as Triangle);
}

const box = metricsFromTriangles(cube(20));
if (Math.abs(box.volumeMm3 - 8000) > 1e-6) throw new Error(`立方体体积错误 ${box.volumeMm3}`);
if (Math.abs(box.surfaceAreaMm2 - 2400) > 1e-6) throw new Error(`立方体表面积错误 ${box.surfaceAreaMm2}`);
if (box.overhang45Percent !== 0) throw new Error(`立方体悬垂错误 ${box.overhang45Percent}`);
if (Math.abs(box.bedContactAreaMm2 - 400) > 1e-6) throw new Error(`贴床面积错误 ${box.bedContactAreaMm2}`);

const sloped: Triangle = [0, 0, 0, 0, 20, -10, 20, 0, 0];
const slope = metricsFromTriangles([sloped]);
if (!(slope.overhang45Percent > 0)) throw new Error(`斜面未识别悬垂 ${slope.overhang45Percent}`);
const expectedArea = Math.hypot(20, 10) * 20 / 2;
if (Math.abs(slope.surfaceAreaMm2 - expectedArea) > 1e-6) throw new Error("斜面面积不一致");

const tall = metricsFromTriangles(cube(20).map((t) => {
  const out = [...t] as number[];
  for (let i = 2; i < 9; i += 3) out[i] *= 7.5;
  return out as Triangle;
}));
const flat = box;
const tallRec = recommendFromMetrics(tall);
const flatRec = recommendFromMetrics(flat);
if (tallRec.recommend.options.brim === flatRec.recommend.options.brim) throw new Error("细高件与扁大件 brim 未区分");
if (tallRec.recommend.overrides.outer_wall_speed === flatRec.recommend.overrides.outer_wall_speed) throw new Error("细高件与扁大件速度未区分");
if (tallRec.recommend.options.wallLoops === flatRec.recommend.options.wallLoops) throw new Error("细高件与扁大件墙数未区分");
console.log("verify-recommend: PASS");
console.log(`cube volume=${box.volumeMm3} surface=${box.surfaceAreaMm2} overhang45=${box.overhang45Percent}% bed=${box.bedContactAreaMm2}`);
console.log(`slope overhang45=${slope.overhang45Percent.toFixed(2)}% area=${slope.surfaceAreaMm2.toFixed(2)}`);
console.log(`tall brim=${tallRec.recommend.options.brim} speed=${tallRec.recommend.overrides.outer_wall_speed} walls=${tallRec.recommend.options.wallLoops}`);
console.log(`flat brim=${flatRec.recommend.options.brim} speed=${flatRec.recommend.overrides.outer_wall_speed} walls=${flatRec.recommend.options.wallLoops}`);

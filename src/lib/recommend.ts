import type { PrintMode, PrintOptions } from "./slicer.ts";
import type { ModelHints } from "./modelHints.ts";

/** 一个世界坐标三角面，按 x,y,z 连续存储三个顶点。 */
/** 三角面顶点数组，前三个顶点各含 x/y/z。 */
export type Triangle = readonly number[];

export type PlateMetrics = {
  bbox: [number, number, number, number, number, number];
  volumeMm3: number;
  surfaceAreaMm2: number;
  overhang45Percent: number;
  overhang60Percent: number;
  /** 中腰水平朝下面（大平悬空/顶棚）的面积：这类面不靠降速、要靠桥接速度与支撑。 */
  flatOverhangMm2: number;
  bedContactAreaMm2: number;
  heightMm: number;
  baseAreaMm2: number;
  heightToBaseRatio: number;
  thinFeatureScore: number;
  triangleCount: number;
};

/** 从 plateMesh/eachTriangle 收集的三角面计算几何指标。该函数不访问文件或网络，便于单测。 */
export function metricsFromTriangles(triangles: Iterable<Triangle>): PlateMetrics {
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let area = 0;
  let signedVolume = 0;
  let minZ = Infinity;
  let triangleCount = 0;
  const rows: { points: Triangle; area: number; nz: number }[] = [];

  for (const t of triangles) {
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = t;
    const points = [x1, y1, z1, x2, y2, z2, x3, y3, z3];
    for (let i = 0; i < 9; i += 3) {
      bbox[0] = Math.min(bbox[0], points[i]);
      bbox[1] = Math.min(bbox[1], points[i + 1]);
      bbox[2] = Math.min(bbox[2], points[i + 2]);
      bbox[3] = Math.max(bbox[3], points[i]);
      bbox[4] = Math.max(bbox[4], points[i + 1]);
      bbox[5] = Math.max(bbox[5], points[i + 2]);
      minZ = Math.min(minZ, points[i + 2]);
    }
    const ux = x2 - x1;
    const uy = y2 - y1;
    const uz = z2 - z1;
    const vx = x3 - x1;
    const vy = y3 - y1;
    const vz = z3 - z1;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const crossLength = Math.hypot(cx, cy, cz);
    const triangleArea = crossLength / 2;
    if (!(triangleArea > 0)) continue;
    const nz = cz / crossLength;
    area += triangleArea;
    // Divergence theorem. Closed meshes with mixed winding use the absolute sum as a
    // conservative volume. For open meshes we fall back to the sum of tetrahedra.
    signedVolume += (x1 * (y2 * z3 - z2 * y3) - y1 * (x2 * z3 - z2 * x3) + z1 * (x2 * y3 - y2 * x3)) / 6;
    rows.push({ points, area: triangleArea, nz });
    triangleCount++;
  }

  if (!triangleCount) {
    return {
      bbox: [0, 0, 0, 0, 0, 0], volumeMm3: 0, surfaceAreaMm2: 0,
      overhang45Percent: 0, overhang60Percent: 0, flatOverhangMm2: 0, bedContactAreaMm2: 0,
      heightMm: 0, baseAreaMm2: 0, heightToBaseRatio: 0, thinFeatureScore: 0, triangleCount: 0,
    };
  }

  const heightMm = Math.max(0, bbox[5] - bbox[2]);
  const tolerance = Math.max(0.05, heightMm * 0.001);
  let over45 = 0;
  let over60 = 0;
  let flatOverhangMm2 = 0;
  let bedContactAreaMm2 = 0;
  for (const row of rows) {
    const p = row.points;
    const lowest = Math.min(p[2], p[5], p[8]);
    const atBed = lowest <= minZ + tolerance && p[2] <= minZ + tolerance && p[5] <= minZ + tolerance && p[8] <= minZ + tolerance;
    if (row.nz < 0 && atBed) {
      bedContactAreaMm2 += row.area;
    }
    // 中腰近水平朝下面 = 大平悬空（顶棚 / 桥面），Orca 对这类面只认 bridge_speed。
    if (row.nz < -0.9 && !atBed) flatOverhangMm2 += row.area;
    // 水平朝下面只有位于最低处才是贴床面，中腰的水平顶棚仍需支撑。
    const horizontalDown = row.nz < -0.999 && Math.abs(p[2] - p[5]) < 1e-6 && Math.abs(p[2] - p[8]) < 1e-6 && atBed;
    // 45° 边界面按“不计入”处理，留出微小数值误差容差。
    if (!horizontalDown && row.nz < -Math.sin(Math.PI / 4) - 1e-12) over45 += row.area;
    if (!horizontalDown && row.nz < -Math.sin(Math.PI / 3) - 1e-12) over60 += row.area;
  }
  // A near-horizontal footprint may be split into several triangles, so the bottom
  // contact area is the best base estimate available from the input mesh.
  const baseAreaMm2 = bedContactAreaMm2;
  const baseWidth = Math.sqrt(Math.max(baseAreaMm2, 1e-9));
  const heightToBaseRatio = heightMm / baseWidth;
  const dims = [bbox[3] - bbox[0], bbox[4] - bbox[1], heightMm].filter((n) => n > 1e-6);
  const minDim = dims.length ? Math.min(...dims) : 0;
  const maxDim = dims.length ? Math.max(...dims) : 0;
  const thinFeatureScore = maxDim > 0 ? Math.max(0, Math.min(1, 1 - minDim / maxDim)) : 0;

  return {
    bbox: bbox as [number, number, number, number, number, number],
    volumeMm3: Math.abs(signedVolume),
    surfaceAreaMm2: area,
    overhang45Percent: area ? (over45 / area) * 100 : 0,
    overhang60Percent: area ? (over60 / area) * 100 : 0,
    flatOverhangMm2,
    bedContactAreaMm2,
    heightMm,
    baseAreaMm2,
    heightToBaseRatio,
    thinFeatureScore,
    triangleCount,
  };
}

export type RecommendationModel = {
  materialType?: string;
  materialDensity?: number;
  hints?: ModelHints;
};

export type RecommendationPreset = {
  mode: PrintMode;
  options: PrintOptions;
  overrides: Record<string, string>;
  reasons: string[];
};

export type Recommendations = {
  recommend: RecommendationPreset;
  speed: RecommendationPreset;
  /** 几何判断与作者说明发生方向冲突时，供接口和 UI 展示。 */
  hintConflicts?: string[];
};

function clampHint(value: number, range: { min?: number; max?: number } | undefined): number {
  if (!range) return value;
  const min = Number.isFinite(range.min) ? range.min! : -Infinity;
  const max = Number.isFinite(range.max) ? range.max! : Infinity;
  return Math.min(max, Math.max(min, value));
}

function formatHintNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function hintRangeText(range: { min?: number; max?: number } | undefined, suffix: string): string {
  if (!range) return "";
  const min = range.min;
  const max = range.max;
  if (min != null && max != null) return `${formatHintNumber(min)}~${formatHintNumber(max)}${suffix}`;
  if (min != null) return `不低于 ${formatHintNumber(min)}${suffix}`;
  if (max != null) return `不高于 ${formatHintNumber(max)}${suffix}`;
  return "";
}

function supportQuote(hints: ModelHints | undefined, mode: "forbidden" | "required"): string | undefined {
  if (!hints) return undefined;
  const quotes = hints.quotes.filter((quote) => /支撑|support/i.test(quote.sentence));
  const pattern = mode === "forbidden"
    ? /禁止|不要|不需|无需|不开|关闭|留空|🚫|\bno supports?\b|\bwithout supports?\b|\bnone\b|\boff\b/i
    : /需要|务必|必须|建议开|\bsupports?\s+(?:are\s+|is\s+)?(?:required|needed)\b|\badd supports?\b/i;
  return quotes.find((quote) => pattern.test(quote.sentence))?.sentence ?? quotes[0]?.sentence;
}

/** 按几何特征生成两套 U1 参数。所有原因都带有本次模型的实际数字，便于用户核对。 */
export function recommendFromMetrics(metrics: PlateMetrics, model: RecommendationModel = {}): Recommendations {
  const hints = model.hints;
  const overhang = metrics.overhang45Percent;
  const severeOverhang = metrics.overhang60Percent;
  const tall = metrics.heightToBaseRatio >= 4 || (metrics.heightMm >= 100 && metrics.baseAreaMm2 > 0 && metrics.heightToBaseRatio >= 3);
  const geometryNeedsSupport = overhang >= 12;
  const needsSupport = hints?.supports === "forbidden" ? false : hints?.supports === "required" ? true : geometryNeedsSupport;
  const supportAngle = severeOverhang >= 8 || overhang >= 25 ? 35 : overhang >= 12 ? 40 : 45;
  const material = (model.materialType ?? "PLA").toUpperCase();
  const supportGap = material === "PETG" || material === "TPU" ? "0.25" : "0.2";
  const geometryBrim: PrintOptions["brim"] = tall || metrics.bedContactAreaMm2 < 250 ? "always" : "auto";
  const brim: PrintOptions["brim"] = hints?.brim === "required" ? "always" : hints?.brim === "forbidden" ? "none" : geometryBrim;
  const recommendLayer = clampHint(0.12, hints?.layerHeight);
  const speedLayer = clampHint(0.20, hints?.layerHeight);
  const recommendInfill = clampHint(18, hints?.infill);
  const speedInfill = clampHint(12, hints?.infill);
  const wallLoops = tall ? 4 : 3;
  const speedWalls = tall ? 2 : 3;
  const speed = tall ? "150" : "190";
  const baseText = `贴床面 ${metrics.bedContactAreaMm2.toFixed(1)} mm²且高度 ${metrics.heightMm.toFixed(1)} mm`;
  // 大平悬空（顶棚/桥面）只认 bridge_speed，实测 Orca 对这类面不套用悬垂分段降速。
  const flatRoof = metrics.flatOverhangMm2;
  const bridgeSpeed = flatRoof >= 300 ? "35" : null;
  const overhangReason = needsSupport
    ? `悬垂 ${overhang.toFixed(1)}%（>45°）、严重悬垂 ${severeOverhang.toFixed(1)}%（>60°）→ 开树状支撑，支撑角 ${supportAngle}°（宁可多支撑，防塌陷）`
    : `悬垂 ${overhang.toFixed(1)}%（>45°）、严重悬垂 ${severeOverhang.toFixed(1)}%（>60°）、未达 12% → 不建支撑，只靠悬垂段降速`;
  const speedPair = "40/25/10";
  const flatReason = flatRoof >= 1
    ? `平悬空 ${flatRoof.toFixed(0)} mm²（中腰水平朝下）${bridgeSpeed ? `→ 桥接速度降到 ${bridgeSpeed} mm/s（实测代价约 +7%）` : "（面积小，桥接速度保持默认）"}`
    : null;

  const recommendReasons = [
    `层高 ${formatHintNumber(recommendLayer)} mm、墙数 ${wallLoops} 圈、填充 ${formatHintNumber(recommendInfill)}%（gyroid），兼顾细节与强度`,
    `${baseText}，高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → ${brim === "always" ? "加 5 mm brim" : "使用自动 brim"}`,
    `悬垂专项：${overhangReason}；悬垂段降速 ${speedPair} mm/s`,
  ];
  if (flatReason) recommendReasons.push(`悬垂专项：${flatReason}`);
  if (tall) recommendReasons.push(`细高件高度 ${metrics.heightMm.toFixed(1)} mm、高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → 外壁速度降至 ${speed} mm/s`);

  const speedReasons = [
    `层高 ${formatHintNumber(speedLayer)} mm、墙数 ${speedWalls} 圈、填充 ${formatHintNumber(speedInfill)}%（gyroid），预计比精细档更快`,
    `外壁速度 ${speed} mm/s，保留表面稳定性并避免极限速度波纹`,
    `${baseText}，高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → ${brim === "always" ? "加 5 mm brim" : "使用自动 brim"}`,
    `悬垂专项：${overhangReason}；悬垂段降速 50/35/15 mm/s`,
  ];
  if (flatReason) speedReasons.push(`悬垂专项：${flatReason}`);
  if (overhang >= 30) speedReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 建议改朝向`);

  const hintConflicts: string[] = [];
  if (hints?.supports === "forbidden") {
    const quote = supportQuote(hints, "forbidden");
    const source = quote ? `（原文「${quote}」）` : "";
    const reason = `作者说明：支撑禁止${source}→ 强制关闭支撑，即使几何指标建议开`;
    recommendReasons.push(reason);
    speedReasons.push(reason);
    if (geometryNeedsSupport) {
      hintConflicts.push(`几何指标建议开支撑（悬垂 ${overhang.toFixed(1)}%），但作者说明禁止支撑 → 已按作者说明关闭`);
    }
  } else if (hints?.supports === "required") {
    const quote = supportQuote(hints, "required");
    const source = quote ? `（原文「${quote}」）` : "";
    const reason = `作者说明：支撑必需${source}→ 强制开启自动支撑`;
    recommendReasons.push(reason);
    speedReasons.push(reason);
    if (!geometryNeedsSupport) {
      hintConflicts.push(`几何指标未建议开支撑（悬垂 ${overhang.toFixed(1)}%），但作者说明要求支撑 → 已按作者说明开启`);
    }
  }
  if (hints?.layerHeight) {
    const rangeText = hintRangeText(hints.layerHeight, " mm");
    const reason = `作者说明：建议层高 ${rangeText} → 层高取 ${formatHintNumber(recommendLayer)} mm（推荐档）/ ${formatHintNumber(speedLayer)} mm（最快档）`;
    recommendReasons.push(reason);
    speedReasons.push(reason);
  }
  if (hints?.infill) {
    const rangeText = hintRangeText(hints.infill, "%");
    const reason = `作者说明：建议填充 ${rangeText} → 填充取 ${formatHintNumber(recommendInfill)}%（推荐档）/ ${formatHintNumber(speedInfill)}%（最快档）`;
    recommendReasons.push(reason);
    speedReasons.push(reason);
  }
  if (hints?.brim) {
    const reason = `作者说明：${hints.brim === "required" ? "需要 brim → 强制开启" : "无需 brim → 关闭"}`;
    recommendReasons.push(reason);
    speedReasons.push(reason);
  }

  const commonOverrides = {
    support_threshold_angle: String(supportAngle),
    support_top_z_distance: supportGap,
    support_bottom_z_distance: supportGap,
    support_interface_top_layers: "3",
    overhang_1_4_speed: "0",
    overhang_2_4_speed: "40",
    overhang_3_4_speed: "25",
    overhang_4_4_speed: "10",
    // overhang_totally_speed 是 Snapmaker 分支私有键，上游 OrcaSlicer 2.4.2 会直接丢弃，
    // 写了也不进 gcode 的 CONFIG 块（实测），故不下发。
  };
  return {
    recommend: {
      mode: "fine",
      options: {
        infillDensity: recommendInfill, infillPattern: "gyroid", wallLoops,
        supports: needsSupport ? "auto" : "off", brim, ironing: true, seam: "back", layers: "fixed",
      },
      overrides: {
        layer_height: formatHintNumber(recommendLayer), outer_wall_speed: tall ? "150" : "180", top_shell_layers: "5", bottom_shell_layers: "4",
        ...commonOverrides, ...(bridgeSpeed ? { bridge_speed: "35" } : {}),
        seam_slope_type: "external", seam_slope_conditional: "1",
      },
      reasons: recommendReasons,
    },
    speed: {
      mode: "fast",
      options: {
        infillDensity: speedInfill, infillPattern: "gyroid", wallLoops: speedWalls,
        supports: needsSupport ? "auto" : "off", brim, ironing: false, seam: "aligned", layers: "fixed",
      },
      overrides: {
        layer_height: formatHintNumber(speedLayer), outer_wall_speed: speed, inner_wall_speed: tall ? "180" : "210",
        top_shell_layers: "4", bottom_shell_layers: "3", support_threshold_angle: String(supportAngle),
        support_top_z_distance: supportGap, support_bottom_z_distance: supportGap, support_interface_top_layers: "3",
        overhang_1_4_speed: "0", overhang_2_4_speed: "50", overhang_3_4_speed: "35", overhang_4_4_speed: "15",
        ...(bridgeSpeed ? { bridge_speed: "40" } : {}),
      },
      reasons: speedReasons,
    },
    hintConflicts,
  };
}

const MATERIAL_DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };

export type RoughEstimate = {
  seconds: number;
  grams: number;
  materialVolumeMm3: number;
  errorNote: string;
};

/**
 * 粗估公式：耗材体积 ≈ 外壳体积 + 填充体积。外壳体积 ≈ 表面积 × 墙圈数 ×
 * 挤出宽度(0.42mm) × 0.7(重叠修正)，填充体积 ≈ 体积 × 填充密度。重量 = 体积 ×
 * 材料密度（g/cm³）。时间使用按层高标定的端到端等效流量，另加换料和熨平时间。
 * 流量常数来自 VM200 / U1 / PLA / 20mm 立方体实测，包含空驶与加减速。
 * 粗估的主要误差项是支撑体积、多色换料、加速度限制和小特征减速。
 */
export function roughEstimate(metrics: PlateMetrics, options: PrintOptions, materialType = "PLA", filamentChanges = 0, layerHeight = 0.2): RoughEstimate {
  const shell = metrics.surfaceAreaMm2 * Math.max(1, options.wallLoops) * 0.42 * 0.7;
  const support = options.supports === "off" ? 0 : metrics.volumeMm3 * (metrics.overhang45Percent / 100) * 0.15;
  const infill = metrics.volumeMm3 * Math.max(0, Math.min(100, options.infillDensity)) / 100;
  const materialVolumeMm3 = shell + infill + support;
  const density = MATERIAL_DENSITY[materialType.toUpperCase()] ?? MATERIAL_DENSITY.PLA;
  const grams = materialVolumeMm3 / 1000 * density;
  const h = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : 0.2;
  // VM200 / U1 / PLA / 20mm 立方体实测，含空驶与加减速。区间外按端点，区间内线性插值。
  const flowAt = (height: number) => {
    const points: [number, number][] = [[0.12, 2.75], [0.20, 3.46], [0.28, 4.10]];
    if (height <= points[0][0]) return points[0][1];
    if (height >= points[2][0]) return points[2][1];
    for (let i = 1; i < points.length; i++) {
      if (height <= points[i][0]) {
        const [h1, f1] = points[i - 1];
        const [h2, f2] = points[i];
        return f1 + (f2 - f1) * (height - h1) / (h2 - h1);
      }
    }
    return points[2][1];
  };
  let seconds = materialVolumeMm3 / flowAt(h) + Math.max(0, filamentChanges) * 12;
  if (options.ironing) seconds *= 1.25;
  return {
    seconds,
    grams,
    materialVolumeMm3,
    errorNote: "粗估的主要误差项：支撑体积、多色换料、加速度限制、小特征减速。",
  };
}

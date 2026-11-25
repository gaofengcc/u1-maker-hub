import type { PrintMode, PrintOptions } from "./slicer.ts";

/** 一个世界坐标三角面，按 x,y,z 连续存储三个顶点。 */
export type Triangle = readonly [number, number, number, number, number, number, number, number, number];

export type PlateMetrics = {
  bbox: [number, number, number, number, number, number];
  volumeMm3: number;
  surfaceAreaMm2: number;
  overhang45Percent: number;
  overhang60Percent: number;
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
  let over45 = 0;
  let over60 = 0;
  let minZ = Infinity;
  let triangleCount = 0;
  const rows: { points: Triangle; area: number; nz: number }[] = [];

  for (const t of triangles) {
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = t;
    const points = [x1, y1, z1, x2, y2, z2, x3, y3, z3] as Triangle;
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
    // 平放在平台上的底面属于贴床面积，不应再被算作悬垂面。
    const horizontalDown = nz < -0.999 && Math.abs(z1 - z2) < 1e-6 && Math.abs(z1 - z3) < 1e-6;
    if (!horizontalDown && nz < -Math.sin(Math.PI / 4)) over45 += triangleArea;
    if (!horizontalDown && nz < -Math.sin(Math.PI / 3)) over60 += triangleArea;
    rows.push({ points, area: triangleArea, nz });
    triangleCount++;
  }

  if (!triangleCount) {
    return {
      bbox: [0, 0, 0, 0, 0, 0], volumeMm3: 0, surfaceAreaMm2: 0,
      overhang45Percent: 0, overhang60Percent: 0, bedContactAreaMm2: 0,
      heightMm: 0, baseAreaMm2: 0, heightToBaseRatio: 0, thinFeatureScore: 0, triangleCount: 0,
    };
  }

  const heightMm = Math.max(0, bbox[5] - bbox[2]);
  const tolerance = Math.max(0.05, heightMm * 0.001);
  let bedContactAreaMm2 = 0;
  for (const row of rows) {
    const p = row.points;
    const lowest = Math.min(p[2], p[5], p[8]);
    if (row.nz < 0 && lowest <= minZ + tolerance && p[2] <= minZ + tolerance && p[5] <= minZ + tolerance && p[8] <= minZ + tolerance) {
      bedContactAreaMm2 += row.area;
    }
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
};

export type RecommendationPreset = {
  mode: PrintMode;
  options: PrintOptions;
  overrides: Record<string, string>;
  reasons: string[];
};

export type Recommendations = { recommend: RecommendationPreset; speed: RecommendationPreset };

/** 按几何特征生成两套 U1 参数。所有原因都带有本次模型的实际数字，便于用户核对。 */
export function recommendFromMetrics(metrics: PlateMetrics, _model: RecommendationModel = {}): Recommendations {
  const overhang = metrics.overhang45Percent;
  const tall = metrics.heightToBaseRatio >= 4 || (metrics.heightMm >= 100 && metrics.baseAreaMm2 > 0 && metrics.heightToBaseRatio >= 3);
  const needsSupport = overhang >= 12;
  const supportAngle = overhang >= 30 ? 35 : 40;
  const brim = tall || metrics.bedContactAreaMm2 < 250 ? "always" : "auto";
  const wallLoops = tall ? 4 : 3;
  const speedWalls = tall ? 2 : 3;
  const speed = tall ? "150" : "190";
  const baseText = `贴床面 ${metrics.bedContactAreaMm2.toFixed(1)} mm²且高度 ${metrics.heightMm.toFixed(1)} mm`;

  const recommendReasons = [
    `层高 0.12 mm、墙数 ${wallLoops} 圈、填充 18%（gyroid），兼顾细节与强度`,
    `${baseText}，高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → ${brim === "always" ? "加 5 mm brim" : "使用自动 brim"}`,
  ];
  if (needsSupport) recommendReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 开启树状支撑，支撑角 ${supportAngle}°`);
  else recommendReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 暂不开启支撑`);
  if (tall) recommendReasons.push(`细高件高度 ${metrics.heightMm.toFixed(1)} mm、高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → 外壁速度降至 ${speed} mm/s`);

  const speedReasons = [
    `层高 0.20 mm、墙数 ${speedWalls} 圈、填充 12%（gyroid），预计比精细档更快`,
    `外壁速度 ${speed} mm/s，保留表面稳定性并避免极限速度波纹`,
    `${baseText}，高/底宽比 ${metrics.heightToBaseRatio.toFixed(2)} → ${brim === "always" ? "加 5 mm brim" : "使用自动 brim"}`,
  ];
  if (needsSupport) speedReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 开启树状支撑，支撑角 ${supportAngle}°`);
  else speedReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 支撑关闭以减少耗材`);
  if (overhang >= 30) speedReasons.push(`悬垂 ${overhang.toFixed(1)}%（>45°）→ 建议改朝向`);

  return {
    recommend: {
      mode: "fine",
      options: {
        infillDensity: 18, infillPattern: "gyroid", wallLoops,
        supports: needsSupport ? "auto" : "off", brim, ironing: true, seam: "back", layers: "fixed",
      },
      overrides: {
        layer_height: "0.12", outer_wall_speed: tall ? "150" : "180", top_shell_layers: "5", bottom_shell_layers: "4",
        support_threshold_angle: String(supportAngle), seam_slope_type: "external", seam_slope_conditional: "1",
      },
      reasons: recommendReasons,
    },
    speed: {
      mode: "fast",
      options: {
        infillDensity: 12, infillPattern: "gyroid", wallLoops: speedWalls,
        supports: needsSupport ? "auto" : "off", brim, ironing: false, seam: "aligned", layers: "fixed",
      },
      overrides: {
        layer_height: "0.20", outer_wall_speed: speed, inner_wall_speed: tall ? "180" : "210",
        top_shell_layers: "4", bottom_shell_layers: "3", support_threshold_angle: String(supportAngle),
      },
      reasons: speedReasons,
    },
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
 * 材料密度（g/cm³）。时间 ≈ 各特征体积 ÷ 平均流量 + 层数 × 1.5s + 换料次数 × 12s。
 * 粗估的主要误差项是支撑体积、多色换料、加速度限制和小特征减速。
 */
export function roughEstimate(metrics: PlateMetrics, options: PrintOptions, materialType = "PLA", filamentChanges = 0): RoughEstimate {
  const shell = metrics.surfaceAreaMm2 * Math.max(1, options.wallLoops) * 0.42 * 0.7;
  const support = options.supports === "off" ? 0 : metrics.volumeMm3 * (metrics.overhang45Percent / 100) * 0.15;
  const infill = metrics.volumeMm3 * Math.max(0, Math.min(100, options.infillDensity)) / 100;
  const materialVolumeMm3 = shell + infill + support;
  const density = MATERIAL_DENSITY[materialType.toUpperCase()] ?? MATERIAL_DENSITY.PLA;
  const grams = materialVolumeMm3 / 1000 * density;
  const layerHeight = options.layers === "fixed" ? 0.2 : 0.16;
  const layers = Math.max(1, Math.ceil(metrics.heightMm / layerHeight));
  const averageFlow = 8;
  const seconds = materialVolumeMm3 / averageFlow + layers * 1.5 + Math.max(0, filamentChanges) * 12;
  return {
    seconds,
    grams,
    materialVolumeMm3,
    errorNote: "粗估的主要误差项：支撑体积、多色换料、加速度限制、小特征减速。",
  };
}

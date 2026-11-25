"use client";

import { useEffect, useMemo, useState } from "react";
import type { PrintOptions as Options } from "@/lib/slicer.ts";
import { t } from "@/lib/i18n";
import { api, duration } from "@/lib/format";

export type EstimateValue = { seconds?: number; grams?: number; cached?: boolean };
export type RecommendationPreset = {
  mode?: string;
  options?: Partial<Options>;
  overrides?: Record<string, string>;
  reasons?: string[];
  estimate?: EstimateValue;
};
export type ModelPreset = {
  options?: Partial<Options>;
  layerHeight?: number;
  material?: string;
  color?: string;
  machine?: string;
  plateCount?: number;
  supportAngle?: number;
  infillPattern?: string;
};
export type PrintOptionsPanelProps = {
  value: Options;
  defaults: Options;
  onChange: (v: Options) => void;
  creatorSupports?: Options["supports"] | null;
  /** Optional model context. When omitted the panel still shows all four tabs with local defaults. */
  instanceId?: string;
  plate?: number;
  site?: string;
  modelPreset?: ModelPreset | null;
  recommendations?: { recommend?: RecommendationPreset; speed?: RecommendationPreset } | null;
};

type MetricsLike = {
  volumeMm3?: number;
  volume?: number;
  surfaceAreaMm2?: number;
  surfaceArea?: number;
  heightMm?: number;
  height?: number;
  bedAreaMm2?: number;
  baseAreaMm2?: number;
};

function roughEstimate(metrics: MetricsLike | null | undefined, options: Options): EstimateValue | null {
  const volume = Number(metrics?.volumeMm3 ?? metrics?.volume);
  const surface = Number(metrics?.surfaceAreaMm2 ?? metrics?.surfaceArea);
  const height = Number(metrics?.heightMm ?? metrics?.height);
  if (!(volume > 0) || !(surface > 0) || !(height > 0)) return null;
  // 粗估公式：耗材体积 ≈ 表面积×墙圈数×挤出宽度(0.42)×0.7 + 体积×填充密度。
  // 重量按 PLA 1.24 g/cm³，时间由体积、层数和约 1.5 秒/层推算。主要误差来自支撑体积、多色换料、加速度限制、小特征减速。
  const materialVolume = surface * options.wallLoops * 0.42 * 0.7 + volume * Math.max(0, options.infillDensity) / 100;
  const grams = (materialVolume / 1000) * 1.24;
  const layers = Math.max(1, Math.ceil(height / (options.layers === "adaptive" ? 0.16 : options.layers === "balanced" ? 0.2 : 0.2)));
  const seconds = Math.round(volume / 18 + layers * 1.5 + (options.supports === "off" ? 0 : 45));
  return { seconds, grams };
}

function presetOptions(base: Options, preset?: RecommendationPreset | null) {
  return { ...base, ...(preset?.options ?? {}) };
}

function Estimate({ value, exact }: { value?: EstimateValue | null; exact?: boolean }) {
  return (
    <span className="muted small">
      {t("print.estimateTime")} {duration(value?.seconds)} · {t("print.estimateFilament")} {value?.grams == null ? "—" : `${value.grams.toFixed(1)}g`}{exact ? ` · ${t("print.estimateExact")}` : ""}
    </span>
  );
}

/** The most commonly changed slicer settings, each explained for someone new to 3D printing. */

const PATTERN_HINTS: Record<Options["infillPattern"], string> = {
  gyroid: t("print.patternHints.gyroid"),
  grid: t("print.patternHints.grid"),
  crosshatch: t("print.patternHints.crosshatch"),
  cubic: t("print.patternHints.cubic"),
  lightning: t("print.patternHints.lightning"),
  honeycomb: t("print.patternHints.honeycomb"),
};
const SUPPORT_HINTS: Record<Options["supports"], string> = {
  off: t("print.supportHints.off"),
  auto: t("print.supportHints.auto"),
  plate: t("print.supportHints.plate"),
};
const SEAM_HINTS: Record<Options["seam"], string> = {
  aligned: t("print.seamHints.aligned"),
  back: t("print.seamHints.back"),
  nearest: t("print.seamHints.nearest"),
  random: t("print.seamHints.random"),
};
const LAYER_HINTS: Record<Options["layers"], string> = {
  fixed: t("print.layerHints.fixed"),
  adaptive: t("print.layerHints.adaptive"),
  balanced: t("print.layerHints.balanced"),
};

function Tag({ kind }: { kind: "strength" | "success" | "looks" }) {
  const map = { strength: ["blue", t("print.strength")], success: ["orange", t("print.printSuccess")], looks: ["purple", t("print.looks")] } as const;
  return <span className={`badge ${map[kind][0]}`}>{map[kind][1]}</span>;
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** `creatorSupports`: what the MakerWorld creator used, when known; shown next to the Supports choice. */
function FineTunePanel({ value, defaults, onChange, creatorSupports = null }: Pick<PrintOptionsPanelProps, "value" | "defaults" | "onChange" | "creatorSupports">) {
  const set = <K extends keyof Options>(key: K, v: Options[K]) => onChange({ ...value, [key]: v });
  const changed = (Object.keys(defaults) as (keyof Options)[]).filter((k) => value[k] !== defaults[k]).length;

  return (
    <section className="panel" style={{ gap: 0 }} aria-labelledby="finetune">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="finetune">{t("print.fineTune")}</h2>
          <p className="muted small" style={{ lineHeight: 1.5 }}>
            {t("print.fineTuneDescription")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted small">{changed === 0 ? t("print.presetDefaults") : t(changed === 1 ? "print.changedOne" : "print.changed", { n: changed })}</span>
          <button type="button" className="btn btn-sm" onClick={() => onChange(defaults)} disabled={changed === 0}>
            {t("print.reset")}
          </button>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.infillDensity")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.infillDensityDesc")}</span>
          <span className="opt-hint">{t("print.infillDensityHint")}</span>
        </div>
        <label className="opt-control field" htmlFor="infill">
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span className="muted">{t("print.hollow")}</span>
            <strong style={{ fontSize: 16 }}>{value.infillDensity}%</strong>
            <span className="muted">{t("print.solid")}</span>
          </span>
          <input id="infill" type="range" min={0} max={100} step={5} value={value.infillDensity} onChange={(e) => set("infillDensity", Number(e.target.value))} />
        </label>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.infillPattern")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.infillPatternDesc")}</span>
          <span className="opt-hint live">{PATTERN_HINTS[value.infillPattern]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="pattern">
            {t("print.pattern")}
          </label>
          <select id="pattern" className="select" value={value.infillPattern} onChange={(e) => set("infillPattern", e.target.value as Options["infillPattern"])}>
            <option value="gyroid">{t("print.gyroid")}（{t("print.recommended")}）</option>
            <option value="crosshatch">{t("print.crosshatch")}</option>
            <option value="grid">{t("print.grid")}</option>
            <option value="cubic">{t("print.cubic")}</option>
            <option value="lightning">{t("print.lightning")}</option>
            <option value="honeycomb">{t("print.honeycomb")}</option>
          </select>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.wallLoops")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.wallLoopsDesc")}</span>
          <span className="opt-hint">{t("print.wallLoopsHint")}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.wallLoops")} value={value.wallLoops} options={[[2, t("print.walls", { n: 2 })], [3, t("print.walls", { n: 3 })], [4, t("print.walls", { n: 4 })]]} onChange={(v) => set("wallLoops", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.supports")} <Tag kind="success" />
          </span>
          <span className="opt-desc">{t("print.supportsDesc")}</span>
          <span className="opt-hint live">{SUPPORT_HINTS[value.supports]}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.supports")} value={value.supports} options={[["off", t("print.supportOff")], ["auto", t("print.supportAuto")], ["plate", t("print.supportPlate")]]} onChange={(v) => set("supports", v)} />
          {creatorSupports && creatorSupports !== "off" && (
            <div className={`notice small${value.supports === "off" ? " error" : " ok"}`} role="status">
              {value.supports === "off"
                ? t("print.supportCreatorOff")
                : t("print.supportCreatorOn", { where: creatorSupports === "plate" ? t("print.onPlateOnly") : "" })}
            </div>
          )}
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.brim")} <Tag kind="success" />
          </span>
          <span className="opt-desc">{t("print.brimDesc")}</span>
          <span className="opt-hint">{t("print.brimHint")}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.brim")} value={value.brim} options={[["none", t("print.none")], ["auto", t("print.supportAuto")], ["always", t("print.always")]]} onChange={(v) => set("brim", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.layerHeight")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.layerHeightDesc")}</span>
          <span className="opt-hint live">{LAYER_HINTS[value.layers]}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.layerHeight")} value={value.layers} options={[["fixed", t("print.fixed")], ["adaptive", t("print.adaptive")], ["balanced", t("print.balanced")]]} onChange={(v) => set("layers", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.ironing")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.ironingDesc")}</span>
          <span className="opt-hint">{t("print.ironingHint")}</span>
        </div>
        <label className="opt-control switch">
          <input type="checkbox" role="switch" checked={value.ironing} onChange={(e) => set("ironing", e.target.checked)} />
          {value.ironing ? t("print.ironingOn") : t("print.supportOff")}
        </label>
      </div>

      <div className="opt-row" style={{ paddingBottom: 0 }}>
        <div className="opt-text">
          <span className="opt-title">
            {t("print.seamPosition")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.seamDesc")}</span>
          <span className="opt-hint live">{SEAM_HINTS[value.seam]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="seam">
            {t("print.seam")}
          </label>
          <select id="seam" className="select" value={value.seam} onChange={(e) => set("seam", e.target.value as Options["seam"])}>
            <option value="aligned">{t("print.aligned")}（{t("print.recommended")}）</option>
            <option value="back">{t("print.back")}</option>
            <option value="nearest">{t("print.nearest")}</option>
            <option value="random">{t("print.random")}</option>
          </select>
        </div>
      </div>
    </section>
  );
}

type TabKey = "model" | "recommend" | "speed" | "custom";

/** 四档打印参数面板。旧调用方不传模型信息时，推荐档使用当前默认值并保持可用。 */
export function PrintOptionsPanel(props: PrintOptionsPanelProps) {
  const { value, defaults, onChange, creatorSupports = null, instanceId, plate = 1, site, modelPreset } = props;
  const [active, setActive] = useState<TabKey>("recommend");
  const [loaded, setLoaded] = useState<PrintOptionsPanelProps["recommendations"]>(props.recommendations ?? null);
  const [creatorPreset, setCreatorPreset] = useState<ModelPreset | null>(props.modelPreset ?? null);
  const [metrics, setMetrics] = useState<MetricsLike | null>(null);
  const [exact, setExact] = useState<Record<string, EstimateValue | null>>({});
  const [exactState, setExactState] = useState<Record<string, "idle" | "running" | "done" | "error">>({});
  const [exactErrors, setExactErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(props.recommendations ?? null);
    setCreatorPreset(props.modelPreset ?? null);
    if (!instanceId) {
      setMetrics(null);
      return;
    }
    let alive = true;
    api<{ metrics?: MetricsLike; presets?: PrintOptionsPanelProps["recommendations"]; creator?: { options?: Partial<Options>; layerHeight?: number | null; infillPattern?: string | null; supportAngle?: number | null; materialTypes?: string[]; materialColors?: string[]; printer?: string; plateCount?: number } | null }>(`/api/recommend/${encodeURIComponent(instanceId)}?plate=${plate}${site ? `&site=${encodeURIComponent(site)}` : ""}`)
      .then((result) => {
        if (!alive) return;
        setMetrics(result.metrics ?? null);
        if (result.presets) setLoaded(result.presets);
        if (result.creator) setCreatorPreset({
          options: result.creator.options,
          layerHeight: result.creator.layerHeight ?? undefined,
          material: result.creator.materialTypes?.[0],
          color: result.creator.materialColors?.[0],
          machine: result.creator.printer,
          plateCount: result.creator.plateCount,
          infillPattern: result.creator.infillPattern ?? undefined,
          supportAngle: result.creator.supportAngle ?? undefined,
        });
      })
      .catch(() => {
        /* recommendation is optional and the current defaults remain usable */
      });
    return () => {
      alive = false;
    };
  }, [instanceId, plate, site, props.recommendations]);

  const recommend = loaded?.recommend;
  const speed = loaded?.speed;
  const recOptions = useMemo(() => presetOptions(defaults, recommend), [defaults, recommend]);
  const speedOptions = useMemo(() => presetOptions(defaults, speed), [defaults, speed]);
  const rough: Record<string, EstimateValue | null> = {
    recommend: recommend?.estimate ?? roughEstimate(metrics, recOptions),
    speed: speed?.estimate ?? roughEstimate(metrics, speedOptions),
    model: roughEstimate(metrics, { ...defaults, ...(creatorPreset?.options ?? modelPreset?.options ?? {}) }),
    custom: roughEstimate(metrics, value),
  };

  const apply = (next: Options) => onChange(next);
  const changedCount = (Object.keys(defaults) as (keyof Options)[]).filter((key) => value[key] !== defaults[key]).length;
  const exactCompare = async () => {
    if (!instanceId) {
      setError(t("print.estimateUnavailable"));
      return;
    }
    const plans: Array<[string, string, Options]> = [
      ["recommend", t("print.tabRecommend"), recOptions],
      ["speed", t("print.tabSpeed"), speedOptions],
      ["custom", t("print.tabCustom"), value],
    ];
    setError(null);
    setExactErrors({});
    setExactState(Object.fromEntries(plans.map(([key]) => [key, "running"])));
    await Promise.all(
      plans.map(async ([key, , options]) => {
        try {
          const result = await api<EstimateValue>("/api/estimate", { method: "POST", body: JSON.stringify({ instanceId, plate, site, mode: key === "speed" ? "fast" : key === "recommend" ? "fine" : "standard", options, exact: true }) });
          setExact((prev) => ({ ...prev, [key]: result }));
          setExactState((prev) => ({ ...prev, [key]: "done" }));
        } catch (e) {
          setExactErrors((prev) => ({ ...prev, [key]: (e as Error).message }));
          setExactState((prev) => ({ ...prev, [key]: "error" }));
          setError((prev) => prev ?? (e as Error).message);
        }
      }),
    );
  };

  const tabs: Array<[TabKey, string]> = [
    ["model", t("print.tabModel")],
    ["recommend", t("print.tabRecommend")],
    ["speed", t("print.tabSpeed")],
    ["custom", t("print.tabCustom")],
  ];
  const displayEstimate = exact[active] ?? rough[active];

  return (
    <section className="panel" style={{ gap: 0 }} aria-labelledby="finetune">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="finetune">{t("print.fineTune")}</h2>
          <p className="muted small" style={{ lineHeight: 1.5 }}>{t("print.fineTuneDescription")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Estimate value={displayEstimate} exact={Boolean(exact[active])} />
          <button type="button" className="btn btn-sm" onClick={exactCompare}>{t("print.exactCompare")}</button>
        </div>
      </div>

      <div role="tablist" aria-label={t("print.parameterTabs")} style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={active === key} className={`btn btn-sm${active === key ? " active" : ""}`} onClick={() => setActive(key)} style={{ flex: "0 0 auto" }}>
            {label}{key === "custom" && changedCount > 0 ? `（${t("print.changed", { n: changedCount })}）` : ""}
          </button>
        ))}
      </div>

      {error && <div className="notice error small" role="alert">{error}</div>}
      {active === "model" && (
        <div className="opt-row" style={{ display: "block" }}>
          <div className="opt-text">
            <span className="opt-title">{t("print.modelPresetReadOnly")}</span>
            {creatorPreset ? <>
              <span className="opt-desc">{t("print.modelPresetSummary", { layer: creatorPreset.layerHeight ?? "—", material: creatorPreset.material ?? "—", machine: creatorPreset.machine ?? "—", plates: creatorPreset.plateCount ?? "—" })}</span>
              <span className="opt-hint">{t("print.modelPresetInfill", { pattern: creatorPreset.infillPattern ?? "—", angle: creatorPreset.supportAngle ?? "—" })}</span>
            </> : <span className="opt-desc">{t("print.modelPresetFallback")}</span>}
          </div>
          {creatorPreset && <button type="button" className="btn btn-sm" onClick={() => apply({ ...defaults, ...(creatorPreset.options ?? {}) })}>{t("print.applyCreatorPreset")}</button>}
        </div>
      )}
      {active === "recommend" && (
        <div>
          <div className="opt-row" style={{ display: "block" }}>
            <div className="opt-text"><span className="opt-title">{t("print.recommendTitle")}</span><span className="opt-desc">{(recommend?.reasons ?? [t("print.recommendFallback")]).join("；")}</span></div>
            <button type="button" className="btn btn-sm" onClick={() => apply(recOptions)}>{t("print.usePreset")}</button>
          </div>
          <Estimate value={exact.recommend ?? rough.recommend} exact={Boolean(exact.recommend)} />
        </div>
      )}
      {active === "speed" && (
        <div>
          <div className="opt-row" style={{ display: "block" }}>
            <div className="opt-text"><span className="opt-title">{t("print.speedTitle")}</span><span className="opt-desc">{(speed?.reasons ?? [t("print.speedFallback")]).join("；")}</span></div>
            <button type="button" className="btn btn-sm" onClick={() => apply(speedOptions)}>{t("print.usePreset")}</button>
          </div>
          <Estimate value={exact.speed ?? rough.speed} exact={Boolean(exact.speed)} />
        </div>
      )}
      {active === "custom" && (
        <>
          {changedCount > 0 && <div className="notice small">{t("print.changed", { n: changedCount })}</div>}
          <FineTunePanel value={value} defaults={defaults} onChange={(next) => { setActive("custom"); onChange(next); }} creatorSupports={creatorSupports} />
        </>
      )}

      {Object.keys(exactState).length > 0 && (
        <div className="opt-row" style={{ display: "block" }}>
          <strong>{t("print.exactCompare")}</strong>
          {(["recommend", "speed", "custom"] as const).map((key) => <div key={key} className="small">{key === "recommend" ? t("print.tabRecommend") : key === "speed" ? t("print.tabSpeed") : t("print.tabCustom")}：{exactState[key] === "running" ? t("print.exactSlicing") : exactState[key] === "done" ? <Estimate value={exact[key]} exact /> : `${t("print.exactFailed")}（${exactErrors[key] ?? t("print.estimateUnavailable")}）`}</div>)}
        </div>
      )}
    </section>
  );
}

"use client";

import type { PrintOptions as Options } from "@/lib/slicer.ts";
import { t } from "@/lib/i18n";

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
export function PrintOptionsPanel({
  value,
  defaults,
  onChange,
  creatorSupports = null,
}: {
  value: Options;
  defaults: Options;
  onChange: (v: Options) => void;
  creatorSupports?: Options["supports"] | null;
}) {
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

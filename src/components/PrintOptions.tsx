"use client";

import type { PrintOptions as Options } from "@/lib/slicer.ts";

/** The most commonly changed slicer settings, each explained for someone new to 3D printing. */

const PATTERN_HINTS: Record<Options["infillPattern"], string> = {
  gyroid: "Gyroid: a wavy 3D mesh, strong in every direction and smooth to print. The best all-round choice.",
  grid: "Grid: simple crossing lines. Fast and strong from the top, a little weaker from the sides.",
  crosshatch: "Crosshatch: the Snapmaker default. Fast, with alternating line directions.",
  cubic: "Cubic: stacked cubes, strong in every direction. Good for functional parts.",
  lightning: "Lightning: only holds up the top surfaces, almost hollow. Fastest and lightest, but weak. Decoration only.",
  honeycomb: "Honeycomb: hexagons, very stiff but slower to print.",
};
const SUPPORT_HINTS: Record<Options["supports"], string> = {
  off: "Off: no scaffolding. Pick this when the creator says the model prints without supports.",
  auto: "Auto: tree-shaped supports added only where the model needs them. Easy to snap off.",
  plate: "Plate only: supports only where they can stand on the plate, never on the model. Cleaner surfaces.",
};
const SEAM_HINTS: Record<Options["seam"], string> = {
  aligned: "Aligned: all the bumps line up in one neat vertical line, usually on a corner.",
  back: "Back: the seam line is hidden at the back of the model.",
  nearest: "Nearest: fastest option, but the bumps are scattered over the surface.",
  random: "Random: no visible line, but the whole surface is slightly rougher.",
};
const LAYER_HINTS: Record<Options["layers"], string> = {
  fixed: "Fixed: every layer has the preset's height.",
  adaptive: "Adaptive: layers get as thin as 0.08 mm where the surface is nearly flat, and keep the preset's height elsewhere. Smoother, a little slower.",
  balanced: "Balanced: the same thin layers, and layers up to 0.28 mm on steep walls, where they hardly show. Smoother tops, often faster than fixed.",
};

function Tag({ kind }: { kind: "strength" | "success" | "looks" }) {
  const map = { strength: ["blue", "Strength"], success: ["orange", "Print success"], looks: ["purple", "Looks"] } as const;
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
          <h2 id="finetune">Fine-tune this print</h2>
          <p className="muted small" style={{ lineHeight: 1.5 }}>
            The settings people change most often, explained in plain words. Not sure? Leave them as they are: the preset is already a good default.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted small">{changed === 0 ? "Preset defaults" : `${changed} setting${changed > 1 ? "s" : ""} changed`}</span>
          <button type="button" className="btn btn-sm" onClick={() => onChange(defaults)} disabled={changed === 0}>
            Reset
          </button>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Infill density <Tag kind="strength" />
          </span>
          <span className="opt-desc">How full the inside of the object is. Prints are not solid: inside there is a light mesh. 0% is hollow, 100% is solid plastic.</span>
          <span className="opt-hint">10 to 20% is plenty for decoration. Use 30 to 50% for parts that hold weight or get squeezed. Higher means slower and more filament.</span>
        </div>
        <label className="opt-control field" htmlFor="infill">
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span className="muted">Hollow</span>
            <strong style={{ fontSize: 16 }}>{value.infillDensity}%</strong>
            <span className="muted">Solid</span>
          </span>
          <input id="infill" type="range" min={0} max={100} step={5} value={value.infillDensity} onChange={(e) => set("infillDensity", Number(e.target.value))} />
        </label>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Infill pattern <Tag kind="strength" />
          </span>
          <span className="opt-desc">The shape of that inner mesh. You never see it once printed, but it changes how strong the part is and how fast it prints.</span>
          <span className="opt-hint live">{PATTERN_HINTS[value.infillPattern]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="pattern">
            Pattern
          </label>
          <select id="pattern" className="select" value={value.infillPattern} onChange={(e) => set("infillPattern", e.target.value as Options["infillPattern"])}>
            <option value="gyroid">Gyroid (recommended)</option>
            <option value="crosshatch">Crosshatch</option>
            <option value="grid">Grid</option>
            <option value="cubic">Cubic</option>
            <option value="lightning">Lightning</option>
            <option value="honeycomb">Honeycomb</option>
          </select>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Wall loops <Tag kind="strength" />
          </span>
          <span className="opt-desc">How many lines make the outer skin of the object. More walls give a tougher shell.</span>
          <span className="opt-hint">2 is fine for most prints. Use 3 or 4 for parts that get screwed, clipped or dropped. This adds more strength than raising infill.</span>
        </div>
        <div className="opt-control">
          <Seg label="Wall loops" value={value.wallLoops} options={[[2, "2 walls"], [3, "3 walls"], [4, "4 walls"]]} onChange={(v) => set("wallLoops", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Supports <Tag kind="success" />
          </span>
          <span className="opt-desc">Temporary scaffolding printed under parts that hang in the air, like an outstretched arm. You snap it off after printing.</span>
          <span className="opt-hint live">{SUPPORT_HINTS[value.supports]}</span>
        </div>
        <div className="opt-control">
          <Seg label="Supports" value={value.supports} options={[["off", "Off"], ["auto", "Auto"], ["plate", "Plate only"]]} onChange={(v) => set("supports", v)} />
          {creatorSupports && creatorSupports !== "off" && (
            <div className={`notice small${value.supports === "off" ? " error" : " ok"}`} role="status">
              {value.supports === "off"
                ? "The creator printed this with supports. Without them, overhangs droop and turn into loose strands."
                : `Set from the creator's profile, which prints with supports${creatorSupports === "plate" ? " on the plate only" : ""}.`}
            </div>
          )}
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Brim <Tag kind="success" />
          </span>
          <span className="opt-desc">A thin flat border printed around the bottom of the object so it stays stuck to the plate. You peel it off afterwards.</span>
          <span className="opt-hint">Helps tall, thin or tiny objects that could come loose or tip over during printing.</span>
        </div>
        <div className="opt-control">
          <Seg label="Brim" value={value.brim} options={[["none", "None"], ["auto", "Auto"], ["always", "Always"]]} onChange={(v) => set("brim", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Layer height <Tag kind="looks" />
          </span>
          <span className="opt-desc">A print is a stack of layers. On a dome or a gentle slope each layer shows as a small step, like contour lines on a map. Thinner layers make smaller steps.</span>
          <span className="opt-hint live">{LAYER_HINTS[value.layers]}</span>
        </div>
        <div className="opt-control">
          <Seg label="Layer height" value={value.layers} options={[["fixed", "Fixed"], ["adaptive", "Adaptive"], ["balanced", "Balanced"]]} onChange={(v) => set("layers", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            Ironing <Tag kind="looks" />
          </span>
          <span className="opt-desc">After the last layer, the hot nozzle passes again over flat top surfaces, like an iron on a shirt. The top comes out smooth and shiny.</span>
          <span className="opt-hint">Only useful when the model has flat tops, like a box lid or a sign. Adds about 10 to 30% print time.</span>
        </div>
        <label className="opt-control switch">
          <input type="checkbox" role="switch" checked={value.ironing} onChange={(e) => set("ironing", e.target.checked)} />
          {value.ironing ? "On: smooth tops" : "Off"}
        </label>
      </div>

      <div className="opt-row" style={{ paddingBottom: 0 }}>
        <div className="opt-text">
          <span className="opt-title">
            Seam position <Tag kind="looks" />
          </span>
          <span className="opt-desc">Each layer starts and ends at one point, which leaves a tiny visible bump called the seam. This chooses where those bumps go.</span>
          <span className="opt-hint live">{SEAM_HINTS[value.seam]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="seam">
            Seam
          </label>
          <select id="seam" className="select" value={value.seam} onChange={(e) => set("seam", e.target.value as Options["seam"])}>
            <option value="aligned">Aligned (recommended)</option>
            <option value="back">Back</option>
            <option value="nearest">Nearest</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>
    </section>
  );
}

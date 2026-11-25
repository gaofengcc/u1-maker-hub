import { DEFAULT_OPTIONS, type PrintOptions } from "./slicer.ts";
import { readSettings } from "./store.ts";

/** The allowed values of each print option, to keep only valid ones from the browser or an old settings file. */
const CHOICES: { [K in keyof PrintOptions]?: readonly PrintOptions[K][] } = {
  infillPattern: ["gyroid", "grid", "crosshatch", "cubic", "lightning", "honeycomb"],
  supports: ["off", "auto", "plate"],
  brim: ["none", "auto", "always"],
  seam: ["aligned", "back", "nearest", "random"],
  layers: ["fixed", "adaptive", "balanced"],
};

/** The valid fields of `value`; anything else is dropped. */
export function cleanOptions(value: unknown): Partial<PrintOptions> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Partial<PrintOptions> = {};
  const infill = Number(v.infillDensity);
  if (v.infillDensity != null && Number.isFinite(infill)) out.infillDensity = Math.max(0, Math.min(100, Math.round(infill)));
  const walls = Number(v.wallLoops);
  if (v.wallLoops != null && Number.isFinite(walls)) out.wallLoops = Math.max(1, Math.min(6, Math.round(walls)));
  if (typeof v.ironing === "boolean") out.ironing = v.ironing;
  for (const key of Object.keys(CHOICES) as (keyof typeof CHOICES)[]) {
    if ((CHOICES[key] as readonly unknown[]).includes(v[key])) (out as Record<string, unknown>)[key] = v[key];
  }
  return out;
}

/** The options every new print starts from: the built-in defaults with the person's saved choices on top. */
export function printDefaults(): PrintOptions {
  return { ...DEFAULT_OPTIONS, ...cleanOptions(readSettings().printDefaults) };
}

/** Browser-safe helpers shared by client components. */

/**
 * MakerWorld serves 1080p PNG originals (often 2 to 3 MB). Its CDN resizes and converts on the fly
 * with the x-oss-process parameter, so a 600 px WebP card image weighs about 20 KB instead.
 */
export function mwImage(url: string | undefined | null, width: number) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("bblmw.com") || u.search) return url;
    return `${url}?x-oss-process=image/resize,w_${width}/format,webp`;
  } catch {
    return url;
  }
}

/** A srcset for responsive MakerWorld images. */
export function mwSrcSet(url: string | undefined | null, widths: number[]) {
  if (!url) return undefined;
  return widths.map((w) => `${mwImage(url, w)} ${w}w`).join(", ");
}

export function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Filament price used when a toolhead has none set, in euros per kilo. */
export const DEFAULT_PRICE_PER_KG = 15;

export function pricePerKg(tool: { pricePerKg?: number } | undefined) {
  const p = tool?.pricePerKg;
  return typeof p === "number" && Number.isFinite(p) && p >= 0 ? p : DEFAULT_PRICE_PER_KG;
}

/** Filament cost of a print: grams used by each toolhead (0..3) times that toolhead's price. */
export function printPrice(gramsByTool: { tool: number; grams: number }[], tools: { pricePerKg?: number }[]) {
  return gramsByTool.reduce((sum, { tool, grams }) => sum + (grams / 1000) * pricePerKg(tools[tool]), 0);
}

/**
 * Filament cost of a sliced print, from the G-code weights. Logical filament i (T{i}) prints on
 * toolhead filamentToTool[i]. Older jobs without per-filament weights use the first mapping.
 */
export function slicedPrice(
  stats: { grams: number | null; gramsByFilament?: number[] },
  filamentToTool: number[],
  tools: { pricePerKg?: number }[],
) {
  if (stats.gramsByFilament) return printPrice(stats.gramsByFilament.map((grams, i) => ({ tool: filamentToTool[i] ?? 0, grams })), tools);
  return stats.grams == null ? null : printPrice([{ tool: filamentToTool[0] ?? 0, grams: stats.grams }], tools);
}

export function euros(amount: number | null | undefined) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `${amount.toFixed(2).replace(".", ",")} €`;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`) as Error & { code?: string };
    err.code = body.code;
    throw err;
  }
  return body as T;
}

/** Relative luminance check so text on a colored chip stays readable. */
export function inkFor(hex: string) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#111827" : "#FFFFFF";
}

/** Distance between two colors, used to pre-match model colors to loaded toolheads. */
export function colorDistance(a: string, b: string) {
  const p = (h: string) => {
    const v = h.replace("#", "").padEnd(6, "0");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** For each model colour, the index of the loaded toolhead with the closest colour. */
export function matchColors(colors: string[], toolColors: string[]): number[] {
  const dist = (k: number, tool: number) => colorDistance(colors[k], toolColors[tool] ?? "#FFFFFF");
  if (colors.length <= toolColors.length) {
    // Few colours: try every one-to-one assignment and keep the closest overall (at most 24 options).
    let best: number[] = [];
    let bestCost = Infinity;
    const walk = (k: number, used: number[], cost: number) => {
      if (cost >= bestCost) return;
      if (k === colors.length) {
        best = used;
        bestCost = cost;
        return;
      }
      for (let t = 0; t < toolColors.length; t++) if (!used.includes(t)) walk(k + 1, [...used, t], cost + dist(k, t));
    };
    walk(0, [], 0);
    return colors.map((_, k) => best[k] ?? 0);
  }
  // More colours than toolheads: each colour goes to its closest toolhead.
  return colors.map((_, k) => toolColors.map((_, t) => t).sort((a, b) => dist(k, a) - dist(k, b))[0]);
}

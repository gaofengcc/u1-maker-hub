import type { ToolLoad } from "./slicer.ts";
import type { ToolState } from "./printer.ts";

/**
 * What is loaded in each toolhead, as the printer reports it (RFID tag or the filament set on its screen),
 * mapped to the U1 filament profiles. A toolhead with nothing loaded keeps its current setting, and so does
 * its price per kilo.
 */
export function toolsFromPrinter(current: ToolLoad[], printer: ToolState[], filaments: string[]): { tools: ToolLoad[]; changed: number } {
  const pick = (type: string, preset: string) => {
    const t = type.toUpperCase().trim();
    if (!t || preset.toUpperCase().includes(t)) return preset;
    if (t === "PLA") return "Snapmaker PLA SnapSpeed @U1";
    return filaments.find((f) => f === `Snapmaker ${t} @U1`) ?? filaments.find((f) => f.startsWith("Snapmaker") && f.toUpperCase().includes(` ${t}`)) ?? preset;
  };
  let changed = 0;
  const tools = current.map((t, i) => {
    const f = printer[i]?.filament;
    if (!f || !f.loaded) return t;
    const next = { ...t, preset: pick(f.type, t.preset), color: f.color.toUpperCase() };
    if (next.preset !== t.preset || next.color !== t.color.toUpperCase()) changed++;
    return next;
  });
  return { tools, changed };
}

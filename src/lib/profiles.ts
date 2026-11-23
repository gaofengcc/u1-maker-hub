import fs from "node:fs";
import path from "node:path";

/**
 * Reads the printer, process and filament presets shipped with OrcaSlicer
 * and resolves their "inherits" chains into flat JSON objects. The slicer CLI
 * resolves inheritance poorly, so every preset passed to it must be flattened.
 */

// macOS: the OrcaSlicer.app bundle. Linux: an extracted AppImage (`--appimage-extract` gives squashfs-root/).
const IS_MAC = process.platform === "darwin";
export const SLICER_APP = process.env.SLICER_APP ?? (IS_MAC ? "/Applications/OrcaSlicer.app" : "/opt/orcaslicer");
export const SLICER_BIN =
  process.env.SLICER_BIN ?? (IS_MAC ? path.join(SLICER_APP, "Contents/MacOS/OrcaSlicer") : path.join(SLICER_APP, "AppRun"));
const PROFILE_ROOT =
  process.env.SLICER_PROFILES ?? (IS_MAC ? path.join(SLICER_APP, "Contents/Resources/profiles") : path.join(SLICER_APP, "resources/profiles"));
const VENDOR_DIRS = ["Snapmaker", "OrcaFilamentLibrary"];

type Kind = "machine" | "process" | "filament";
export type Preset = Record<string, unknown> & { name: string; type?: string; inherits?: string };

let presetIndex: Map<string, { kind: Kind; data: Preset }> | null = null;

function loadIndex() {
  if (presetIndex) return presetIndex;
  const index = new Map<string, { kind: Kind; data: Preset }>();
  for (const vendor of VENDOR_DIRS) {
    for (const kind of ["machine", "process", "filament"] as Kind[]) {
      const dir = path.join(PROFILE_ROOT, vendor, kind);
      if (!fs.existsSync(dir)) continue;
      walk(dir, (file) => {
        if (!file.endsWith(".json")) return;
        try {
          const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as Preset;
          // Snapmaker presets win over library presets of the same name.
          if (data.name && !index.has(data.name)) index.set(data.name, { kind, data });
        } catch {
          /* ignore unreadable preset */
        }
      });
    }
  }
  presetIndex = index;
  return index;
}

function walk(dir: string, visit: (file: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

export function flattenPreset(name: string): Preset {
  const index = loadIndex();
  const chain: Preset[] = [];
  let current = index.get(name);
  if (!current) throw new Error(`Preset not found: ${name}`);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.data.name)) break;
    seen.add(current.data.name);
    chain.unshift(current.data);
    current = current.data.inherits ? index.get(current.data.inherits) : undefined;
  }
  const flat: Preset = { name };
  for (const layer of chain) Object.assign(flat, layer);
  flat.name = name;
  delete flat.inherits;
  return flat;
}

export function listPresets(kind: Kind, filter: (p: Preset) => boolean = () => true) {
  return [...loadIndex().values()]
    .filter((p) => p.kind === kind && p.data.instantiation !== "false" && filter(p.data))
    .map((p) => p.data.name)
    .sort();
}

export const U1_MACHINE = "Snapmaker U1 (0.4 nozzle)";

export function u1Filaments() {
  return listPresets("filament", (p) => {
    const compat = p.compatible_printers as string[] | undefined;
    return Array.isArray(compat) && compat.includes(U1_MACHINE);
  });
}

export function u1Processes() {
  return listPresets("process", (p) => /@Snapmaker U1 \(0\.4 nozzle\)/.test(p.name));
}

import fs from "node:fs";
import path from "node:path";
import type { ToolLoad } from "./slicer.ts";

/** Local, single-user storage. Everything lives in ./data, which is git-ignored. */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const DOWNLOAD_DIR = path.join(DATA_DIR, "downloads");
export const JOB_DIR = path.join(DATA_DIR, "jobs");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export type BambuUser = { uid?: string | number; name?: string; avatar?: string };

export type Settings = {
  bambuToken?: string;
  bambuRefreshToken?: string;
  bambuUser?: BambuUser;
  tokenSavedAt?: string;
  printerHost?: string; // "192.168.1.42" or "192.168.1.42:7125"
  /** Home Assistant, to switch the printer's smart plug (see homeassistant.ts). */
  haUrl?: string;
  haToken?: string;
  /** Entity id (switch.u1_plug) or device id of the plug. */
  haPlug?: string;
  tools: ToolLoad[];
};

const DEFAULT_SETTINGS: Settings = {
  tools: [
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#F5F5F0" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#1F2328" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#C62D2D" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#1C6FC6" },
  ],
};

export function readSettings(): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...saved, tools: saved.tools?.length === 4 ? saved.tools : DEFAULT_SETTINGS.tools };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** Settings safe to send to the browser: never the tokens themselves. */
export function publicSettings() {
  const s = readSettings();
  return {
    loggedIn: Boolean(s.bambuToken),
    bambuUser: s.bambuUser ?? null,
    tokenSavedAt: s.tokenSavedAt ?? null,
    printerHost: s.printerHost ?? "",
    haUrl: s.haUrl ?? "",
    haPlug: s.haPlug ?? "",
    haTokenSet: Boolean(s.haToken),
    tools: s.tools,
  };
}

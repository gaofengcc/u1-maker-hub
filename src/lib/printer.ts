import fs from "node:fs";
import { readSettings } from "./store.ts";

/**
 * Snapmaker U1 client over its Moonraker API (LAN, no API key for trusted subnets).
 * The browser never talks to the printer directly: Moonraker's CORS list would block it.
 */

export class PrinterError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export function printerBase(host = readSettings().printerHost) {
  if (!host) throw new PrinterError("No printer address set. Add it in Settings.", 400);
  const trimmed = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function moonraker<T>(pathname: string, init: RequestInit = {}, host?: string, timeoutMs = 6000): Promise<T> {
  const url = `${printerBase(host)}${pathname}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new PrinterError(`The printer at ${printerBase(host)} ${reason}. Check that it is on and on the same network.`);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
  if (!res.ok) {
    if (res.status === 401) throw new PrinterError("The printer refused this computer (401). Add its subnet to trusted_clients in moonraker.conf.", 401);
    throw new PrinterError(body.error?.message ?? `The printer answered ${res.status}.`, res.status);
  }
  // Most Moonraker endpoints wrap the answer in "result"; file upload answers at the top level.
  return (body.result ?? body) as T;
}

const TOOLS = ["extruder", "extruder1", "extruder2", "extruder3"] as const;
const QUERY_OBJECTS = [
  "webhooks",
  "print_stats",
  "virtual_sdcard",
  "display_status",
  "pause_resume",
  "heater_bed",
  "toolhead",
  "gcode_move",
  "fan",
  "led cavity_led",
  "print_task_config",
  ...TOOLS,
];

export type ToolState = { index: number; temp: number; target: number; state: string; active: boolean; filament: { type: string; color: string; vendor: string; loaded: boolean } };

export type PrinterStatus = {
  online: true;
  klippy: string;
  state: string; // standby | printing | paused | complete | cancelled | error
  message: string;
  filename: string;
  progress: number; // 0..1
  printSeconds: number;
  etaSeconds: number | null;
  layer: number | null;
  totalLayers: number | null;
  bed: { temp: number; target: number };
  tools: ToolState[];
  speedFactor: number;
  fanSpeed: number;
  light: boolean;
};

type Obj = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export async function getStatus(): Promise<PrinterStatus> {
  const qs = QUERY_OBJECTS.map((o) => encodeURIComponent(o)).join("&");
  const result = await moonraker<{ status: Record<string, Obj> }>(`/printer/objects/query?${qs}`);
  const s = result.status ?? {};
  const stats = s.print_stats ?? {};
  const info = (stats.info as Obj) ?? {};
  const progress = num((s.display_status ?? {}).progress, num((s.virtual_sdcard ?? {}).progress));
  const printSeconds = num(stats.print_duration);
  const activeExtruder = String((s.toolhead ?? {}).extruder ?? "extruder");
  const task = s.print_task_config ?? {};
  const listOf = (key: string) => (Array.isArray(task[key]) ? (task[key] as unknown[]) : []);
  const types = listOf("filament_type");
  const colors = listOf("filament_color_rgba").length ? listOf("filament_color_rgba") : listOf("filament_color");
  const vendors = listOf("filament_vendor");
  const exists = listOf("filament_exist");

  const tools = TOOLS.map((name, index) => {
    const t = s[name] ?? {};
    return {
      index,
      temp: num(t.temperature),
      target: num(t.target),
      state: String(t.state ?? ""),
      active: activeExtruder === name,
      filament: {
        type: String(types[index] ?? ""),
        color: toHex(colors[index]),
        vendor: String(vendors[index] ?? ""),
        loaded: exists.length ? Boolean(exists[index]) : true,
      },
    };
  });

  const state = String(stats.state ?? "standby");
  return {
    online: true,
    klippy: String((s.webhooks ?? {}).state ?? "unknown"),
    state: (s.pause_resume ?? {}).is_paused ? "paused" : state,
    message: String(stats.message || (s.webhooks ?? {}).state_message || ""),
    filename: String(stats.filename ?? ""),
    progress,
    printSeconds,
    etaSeconds: progress > 0.01 && state === "printing" ? Math.round(printSeconds / progress - printSeconds) : null,
    layer: info.current_layer == null ? null : num(info.current_layer),
    totalLayers: info.total_layer == null ? null : num(info.total_layer),
    bed: { temp: num((s.heater_bed ?? {}).temperature), target: num((s.heater_bed ?? {}).target) },
    tools,
    speedFactor: num((s.gcode_move ?? {}).speed_factor, 1),
    fanSpeed: num((s.fan ?? {}).speed),
    light: Array.isArray((s["led cavity_led"] ?? {}).color_data)
      ? ((s["led cavity_led"].color_data as number[][])[0] ?? []).some((c) => c > 0)
      : false,
  };
}

function toHex(value: unknown) {
  if (typeof value !== "string" || !value) return "#9CA3AF";
  const hex = value.replace(/^#/, "");
  return `#${hex.slice(0, 6).toUpperCase()}`;
}

export async function serverInfo(host?: string) {
  return moonraker<{ klippy_state: string; moonraker_version?: string }>("/server/info", {}, host);
}

export async function printerAction(action: "pause" | "resume" | "cancel") {
  return moonraker(`/printer/print/${action}`, { method: "POST" });
}

export async function runGcode(script: string) {
  return moonraker(`/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: "POST" }, undefined, 120_000);
}

/** Uploads G-code to the printer's gcodes folder, optionally starting it right away. */
export async function uploadGcode(file: string, remoteName: string, startPrint: boolean) {
  const form = new FormData();
  const bytes = fs.readFileSync(file);
  form.append("file", new Blob([bytes]), remoteName);
  form.append("root", "gcodes");
  if (startPrint) form.append("print", "true");
  return moonraker<{ item?: { path: string }; print_started?: boolean }>(
    "/server/files/upload",
    { method: "POST", body: form },
    undefined,
    10 * 60_000,
  );
}

export async function startPrint(remoteName: string) {
  return moonraker(`/printer/print/start?filename=${encodeURIComponent(remoteName)}`, { method: "POST" });
}

export async function jobHistory(limit = 10) {
  const r = await moonraker<{ jobs: { filename: string; status: string; print_duration: number; end_time: number; filament_used: number }[] }>(
    `/server/history/list?limit=${limit}&order=desc`,
  );
  return r.jobs ?? [];
}

/**
 * Camera images. Stock U1 firmware has no MJPEG stream: once woken, the camera service rewrites
 * a 1080p JPEG about once a second in Moonraker's "camera" file root. Extended firmware also
 * serves /webcam/snapshot.jpg, used as a fallback.
 */
export function cameraUrls() {
  const base = printerBase();
  return [`${base}/server/files/camera/monitor.jpg`, `${base}/webcam/snapshot.jpg`];
}

const camera = ((globalThis as { __u1Camera?: { wokenAt: number; pending: Promise<void> | null } }).__u1Camera ??= { wokenAt: 0, pending: null });

/**
 * Asks the U1 to keep its LAN camera running (camera.start_monitor, websocket-only in Moonraker).
 * This is what the Snapmaker app sends to show the camera; it does not touch motion, heaters or the print.
 * Throttled: the camera stays awake a few minutes per call.
 */
export function wakeCamera(force = false): Promise<void> {
  if (!force && Date.now() - camera.wokenAt < 45_000) return Promise.resolve();
  if (camera.pending) return camera.pending;
  const wsUrl = printerBase().replace(/^http/, "ws") + "/websocket";
  camera.pending = new Promise<void>((resolve) => {
    const id = Math.floor(Math.random() * 1e6);
    const ws = new WebSocket(wsUrl);
    const done = () => {
      clearTimeout(timer);
      camera.pending = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const timer = setTimeout(done, 8000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "camera.start_monitor", params: { domain: "lan", interval: 0, req_id: id }, id }));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id !== id) return;
        if (msg.result?.state === "success") camera.wokenAt = Date.now();
      } catch {
        /* ignore non-JSON frames */
      }
      done();
    };
    ws.onerror = done;
  });
  return camera.pending;
}

export function safeRemoteName(title: string) {
  const stem = title
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return `${stem || "print"}_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.gcode`;
}


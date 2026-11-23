// A tiny fake Snapmaker U1 (Moonraker API subset) for developing without the printer.
// Run: node scripts/mock-u1.mjs [port]   then set the printer address to localhost:<port>.
import http from "node:http";

const port = Number(process.argv[2] ?? 7125);
const state = {
  status: "standby",
  filename: "",
  progress: 0,
  started: 0,
  paused: false,
  speed: 1,
  fan: 0,
  light: 1,
  bed: { temperature: 24, target: 0 },
  tools: [0, 1, 2, 3].map(() => ({ temperature: 25, target: 0 })),
  map: [0, 1, 2, 3],
  files: [],
  history: [],
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const json = (res, result, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(code === 200 ? { result } : { error: { message: result } }));
};

function tick() {
  if (state.status === "printing" && !state.paused) {
    state.progress = Math.min(1, state.progress + 0.002);
    if (state.progress >= 1) {
      state.status = "complete";
      state.history.unshift({ filename: state.filename, status: "completed", print_duration: (Date.now() - state.started) / 1000, end_time: Date.now() / 1000 });
      state.map = [0, 1, 2, 3];
    }
  }
  const approach = (h) => (h.temperature += ((h.target || 25) - h.temperature) * 0.2);
  approach(state.bed);
  state.tools.forEach(approach);
}
setInterval(tick, 1000);

function objects() {
  const names = ["extruder", "extruder1", "extruder2", "extruder3"];
  const out = {
    webhooks: { state: "ready", state_message: "Printer is ready" },
    print_stats: {
      state: state.status,
      filename: state.filename,
      print_duration: state.started ? (Date.now() - state.started) / 1000 : 0,
      message: "",
      info: { current_layer: Math.round(state.progress * 138), total_layer: 138 },
    },
    virtual_sdcard: { progress: state.progress },
    display_status: { progress: state.progress },
    pause_resume: { is_paused: state.paused },
    heater_bed: state.bed,
    toolhead: { extruder: state.status === "printing" ? names[state.map[0]] : "extruder" },
    gcode_move: { speed_factor: state.speed },
    fan: { speed: state.fan },
    "led cavity_led": { color_data: [[0, 0, 0, state.light]] },
    print_task_config: {
      filament_type: ["PLA", "PLA", "PLA", "PETG"],
      filament_vendor: ["Snapmaker", "Snapmaker", "Snapmaker", "Generic"],
      filament_color_rgba: ["F5F5F0FF", "1F2328FF", "C62D2DFF", "1C6FC6FF"],
      filament_exist: [true, true, true, true],
      extruder_map_table: state.map,
    },
  };
  names.forEach((n, i) => (out[n] = { ...state.tools[i], state: i === 0 ? "ACTIVATE" : "PARKED" }));
  return out;
}

function runScript(script) {
  for (const line of script.split("\n")) {
    log("gcode:", line);
    let m;
    if ((m = /^SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=(\d+) MAP_EXTRUDER=(\d+)/.exec(line))) {
      if (state.status === "printing" || state.status === "paused") throw new Error("not allowed to set extruder map during printing!");
      state.map[Number(m[1])] = Number(m[2]);
    } else if ((m = /^M220 S(\d+)/.exec(line))) state.speed = Number(m[1]) / 100;
    else if ((m = /^M106 S(\d+)/.exec(line))) state.fan = Number(m[1]) / 255;
    else if ((m = /^M140 S(\d+)/.exec(line))) state.bed.target = Number(m[1]);
    else if ((m = /^M104 T(\d) S(\d+)/.exec(line))) state.tools[Number(m[1])].target = Number(m[2]);
    else if ((m = /^SET_LED .*WHITE=(\d)/.exec(line))) state.light = Number(m[1]);
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    log(req.method, p + url.search.slice(0, 80));
    try {
      if (p === "/server/info") return json(res, { klippy_state: "ready", moonraker_version: "mock-u1" });
      if (p === "/printer/objects/query") return json(res, { status: objects() });
      if (p === "/server/history/list") return json(res, { jobs: state.history.slice(0, 8) });
      if (p === "/printer/gcode/script") {
        runScript(url.searchParams.get("script") ?? "");
        return json(res, "ok");
      }
      if (p === "/printer/print/start") {
        if (state.status === "printing") return json(res, "Printer is busy", 400);
        state.filename = url.searchParams.get("filename");
        Object.assign(state, { status: "printing", progress: 0, started: Date.now(), paused: false });
        state.bed.target = 65;
        state.tools[state.map[0]].target = 220;
        log("PRINT START", state.filename, "map", state.map.join(","));
        return json(res, "ok");
      }
      if (p === "/printer/print/pause") return (state.paused = true), json(res, "ok");
      if (p === "/printer/print/resume") return (state.paused = false), json(res, "ok");
      if (p === "/printer/print/cancel") {
        state.history.unshift({ filename: state.filename, status: "cancelled", print_duration: (Date.now() - state.started) / 1000, end_time: Date.now() / 1000 });
        Object.assign(state, { status: "cancelled", paused: false, map: [0, 1, 2, 3] });
        return json(res, "ok");
      }
      if (p === "/server/files/upload") {
        let size = 0;
        req.on("data", (c) => (size += c.length));
        req.on("end", () => {
          log("upload bytes", size);
          // Real Moonraker answers uploads without the "result" wrapper.
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ item: { path: `u1hub_${Date.now()}.gcode`, root: "gcodes" }, print_started: false, action: "create_file" }));
        });
        return;
      }
      if (p.startsWith("/webcam/")) {
        res.writeHead(404);
        return res.end();
      }
      json(res, "Not found", 404);
    } catch (err) {
      json(res, err.message, 400);
    }
  })
  .listen(port, () => log(`mock U1 listening on http://localhost:${port}`));

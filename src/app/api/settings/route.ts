import { NextResponse } from "next/server";
import { publicSettings, writeSettings } from "@/lib/store.ts";
import { readJson } from "@/lib/http.ts";
import type { ToolLoad } from "@/lib/slicer.ts";
import { DEFAULT_PRICE_PER_KG } from "@/lib/format.ts";
import { isPlugRef } from "@/lib/homeassistant.ts";

export async function GET() {
  return NextResponse.json(publicSettings());
}

/**
 * Saves the printer address, the Home Assistant plug and what is loaded in each toolhead, with its price.
 * The Bambu token is managed by /api/auth/token. An empty Home Assistant token keeps the saved one; null removes it.
 */
export async function PUT(req: Request) {
  const body = await readJson<{ printerHost?: string; tools?: ToolLoad[]; haUrl?: string; haToken?: string | null; haPlug?: string }>(req);
  const patch: Parameters<typeof writeSettings>[0] = {};
  if (typeof body.printerHost === "string") {
    const host = body.printerHost.trim();
    if (host && !/^(https?:\/\/)?[\w.-]+(:\d+)?\/?$/.test(host)) {
      return NextResponse.json({ error: "Use an address like 192.168.1.42 or u1.local:7125." }, { status: 400 });
    }
    patch.printerHost = host;
  }
  if (typeof body.haUrl === "string") {
    const url = body.haUrl.trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) {
      return NextResponse.json({ error: "Use a Home Assistant address like http://homeassistant.local:8123." }, { status: 400 });
    }
    patch.haUrl = url;
  }
  if (typeof body.haPlug === "string") {
    const plug = body.haPlug.trim();
    if (plug && !isPlugRef(plug)) {
      return NextResponse.json({ error: "Use the plug's entity id (switch.…) or its device id from the Home Assistant device page." }, { status: 400 });
    }
    patch.haPlug = plug;
  }
  if (body.haToken === null) patch.haToken = undefined;
  else if (typeof body.haToken === "string" && body.haToken.trim()) patch.haToken = body.haToken.trim();
  if (Array.isArray(body.tools) && body.tools.length === 4) {
    patch.tools = body.tools.map((t) => {
      const price = Number(t.pricePerKg);
      return {
        preset: String(t.preset),
        color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color.toUpperCase() : "#FFFFFF",
        pricePerKg: Number.isFinite(price) && price >= 0 ? Math.min(1000, Math.round(price * 100) / 100) : DEFAULT_PRICE_PER_KG,
      };
    });
  }
  writeSettings(patch);
  return NextResponse.json(publicSettings());
}

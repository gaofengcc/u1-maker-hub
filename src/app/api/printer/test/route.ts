import { NextResponse } from "next/server";
import { serverInfo } from "@/lib/printer.ts";
import { readJson } from "@/lib/http.ts";

/** Checks that a printer address answers like Moonraker before saving it. */
export async function POST(req: Request) {
  const { host } = await readJson<{ host?: string }>(req);
  if (!host?.trim()) return NextResponse.json({ ok: false, error: "Enter the printer address." }, { status: 400 });
  try {
    const info = await serverInfo(host);
    return NextResponse.json({ ok: true, klippy: info.klippy_state, version: info.moonraker_version ?? "" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

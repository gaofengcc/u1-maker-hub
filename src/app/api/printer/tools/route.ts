import { connection, NextResponse } from "next/server";
import { getStatus } from "@/lib/printer.ts";
import { u1Filaments } from "@/lib/profiles.ts";
import { toolsFromPrinter } from "@/lib/printerTools.ts";
import { readSettings, writeSettings } from "@/lib/store.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

/**
 * Reads what is loaded in the four toolheads from the printer. With `save`, it becomes the saved toolhead
 * setup right away (model and plate pages); without, the Settings page shows it to check before saving.
 */
export async function POST(req: Request) {
  await connection();
  const { save } = await readJson<{ save?: boolean }>(req);
  const settings = readSettings();
  if (!settings.printerHost) return NextResponse.json({ error: "Add your printer address in Settings first." }, { status: 400 });
  try {
    const status = await getStatus();
    let filaments: string[] = [];
    try {
      filaments = u1Filaments();
    } catch {
      /* without the profiles, only colours and PLA are read */
    }
    const { tools, changed } = toolsFromPrinter(settings.tools, status.tools, filaments);
    if (save) writeSettings({ tools });
    return NextResponse.json({ tools, changed, saved: Boolean(save) });
  } catch (err) {
    return errorResponse(err);
  }
}

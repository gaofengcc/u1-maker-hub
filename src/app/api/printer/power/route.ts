import { connection, NextResponse } from "next/server";
import { getPower, powerConfigured, setPower } from "@/lib/homeassistant.ts";
import { getStatus } from "@/lib/printer.ts";
import { readSettings } from "@/lib/store.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

/** The printer's smart plug in Home Assistant: its state, and on/off. */
export async function GET() {
  await connection();
  if (!powerConfigured()) return NextResponse.json({ configured: false });
  try {
    return NextResponse.json({ configured: true, ...(await getPower()) });
  } catch (err) {
    return NextResponse.json({ configured: true, state: "unknown", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Turning off is refused while a print runs or is paused: cutting the power would lose it. */
export async function POST(req: Request) {
  const { on } = await readJson<{ on?: boolean }>(req);
  if (typeof on !== "boolean") return NextResponse.json({ error: "Say on: true or on: false." }, { status: 400 });
  try {
    if (!on && readSettings().printerHost) {
      // A printer that does not answer is already off or unreachable: nothing to lose.
      const state = await getStatus().then((s) => s.state).catch(() => null);
      if (state === "printing" || state === "paused") {
        return NextResponse.json({ error: "A print is running. Cancel it before turning the printer off." }, { status: 409 });
      }
    }
    await setPower(on);
    return NextResponse.json({ configured: true, ...(await getPower()) });
  } catch (err) {
    return errorResponse(err);
  }
}

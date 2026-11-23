import { NextResponse } from "next/server";
import { printerAction, runGcode } from "@/lib/printer.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

type Body = { action?: string; value?: number; tool?: number; on?: boolean };

/**
 * Printer controls. Only a fixed set of actions is accepted: the browser never sends raw G-code.
 */
export async function POST(req: Request) {
  const b = await readJson<Body>(req);
  const n = (v: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
  try {
    switch (b.action) {
      case "pause":
      case "resume":
      case "cancel":
        await printerAction(b.action);
        break;
      case "speed":
        await runGcode(`M220 S${n(b.value, 10, 300)}`);
        break;
      case "fan":
        await runGcode(`M106 S${Math.round((n(b.value, 0, 100) / 100) * 255)}`);
        break;
      case "light":
        await runGcode(`SET_LED LED=cavity_led WHITE=${b.on ? 1 : 0}`);
        break;
      case "home":
        await runGcode("G28");
        break;
      case "bed":
        await runGcode(`M140 S${n(b.value, 0, 110)}`);
        break;
      case "nozzle":
        // M104 with T<n> sets a tool's temperature without a physical tool change.
        await runGcode(`M104 T${n(b.tool, 0, 3)} S${n(b.value, 0, 300)}`);
        break;
      case "cooldown":
        await runGcode("M140 S0\nM104 T0 S0\nM104 T1 S0\nM104 T2 S0\nM104 T3 S0");
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

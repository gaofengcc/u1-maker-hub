import { connection, NextResponse } from "next/server";
import { u1Filaments } from "@/lib/profiles.ts";
import { DEFAULT_OPTIONS, PRINT_MODES } from "@/lib/slicer.ts";
import { errorResponse } from "@/lib/http.ts";

export async function GET() {
  await connection();
  try {
    return NextResponse.json({
      modes: Object.entries(PRINT_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description, process: m.process })),
      defaults: DEFAULT_OPTIONS,
      filaments: u1Filaments(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

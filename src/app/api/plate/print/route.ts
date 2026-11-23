import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs.ts";
import { listPlate } from "@/lib/plate.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

type Body = { mode?: string; options?: Partial<PrintOptions>; send?: boolean };

/** Slices everything on the plate, on as many U1 plates as needed, and optionally sends the first one to the printer. */
export async function POST(req: Request) {
  const b = await readJson<Body>(req);
  const entries = listPlate();
  if (!entries.length) return NextResponse.json({ error: "The plate is empty. Add models from their pages first." }, { status: 400 });
  const mode = (b.mode && b.mode in PRINT_MODES ? b.mode : "fast") as PrintMode;
  const names = entries.map((e) => (e.copies > 1 ? `${e.copies}× ${e.title}` : e.title));
  try {
    const job = createJob({
      designId: entries[0].designId,
      instanceId: entries[0].instanceId,
      title: `Plate: ${names.join(", ")}`.slice(0, 200),
      cover: entries[0].cover,
      mode,
      options: { ...DEFAULT_OPTIONS, ...(b.options ?? {}) },
      plate: 1,
      items: entries.map(({ designId, instanceId, uploadId, title, plate, size, rotation, orient, copies, bed, filamentToTool }) => ({
        designId,
        instanceId,
        uploadId,
        title,
        plate,
        size,
        rotation,
        orient,
        copies,
        bed,
        filamentToTool,
      })),
      filamentToTool: [0, 1, 2, 3],
      send: Boolean(b.send),
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

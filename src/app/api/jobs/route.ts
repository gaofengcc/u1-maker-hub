import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/jobs.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import type { PlateTransform } from "@/lib/geometry.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { getUpload, uploadKind } from "@/lib/uploads.ts";
import { cleanOrient } from "@/lib/orient.ts";

export async function GET() {
  return NextResponse.json(listJobs().map((job) => ({ ...job, log: [] })));
}

type Body = {
  designId?: number;
  instanceId?: number;
  /** An uploaded STL or 3MF, instead of a MakerWorld model. */
  uploadId?: string;
  title?: string;
  cover?: string;
  mode?: string;
  options?: Partial<PrintOptions>;
  plate?: number;
  transform?: { scale?: number; rotation?: number; orient?: unknown };
  filamentToTool?: number[];
  send?: boolean;
};

/** 10% to 500%, a rotation in 0..359 degrees, and an orientation when it is a real rotation. */
function cleanTransform(t: Body["transform"]): PlateTransform {
  const scale = Number(t?.scale ?? 1);
  const rotation = Math.round(Number(t?.rotation ?? 0));
  return {
    scale: Number.isFinite(scale) ? Math.max(0.1, Math.min(5, scale)) : 1,
    rotation: Number.isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0,
    orient: cleanOrient(t?.orient),
  };
}

export async function POST(req: Request) {
  const b = await readJson<Body>(req);
  const upload = b.uploadId ? getUpload(String(b.uploadId)) : null;
  if (b.uploadId && !upload) return NextResponse.json({ error: "This upload no longer exists. Upload the file again." }, { status: 404 });
  if (!upload && (!Number.isInteger(b.designId) || !Number.isInteger(b.instanceId))) {
    return NextResponse.json({ error: "Pick a model and a print profile." }, { status: 400 });
  }
  const mode = (b.mode && b.mode in PRINT_MODES ? b.mode : "fast") as PrintMode;
  const kind = upload ? uploadKind(upload) : null;
  let plate = Math.max(0, Math.round(Number(b.plate ?? 1)) || 0);
  // An STL is one piece; a 3MF prints one of its plates.
  if (kind === "stl") plate = 0;
  if (kind === "3mf" && !upload!.project?.plates.some((p) => p.index === plate)) {
    return NextResponse.json({ error: `This 3MF has no plate ${plate} with objects on it.` }, { status: 400 });
  }
  try {
    const job = createJob({
      designId: upload ? 0 : b.designId!,
      instanceId: upload ? 0 : b.instanceId!,
      upload: upload ? { id: upload.id, name: upload.name, kind: kind! } : undefined,
      title: String(b.title ?? upload?.name ?? "MakerWorld model").slice(0, 200),
      cover: String(b.cover ?? ""),
      mode,
      options: { ...DEFAULT_OPTIONS, ...(b.options ?? {}) },
      plate,
      transform: cleanTransform(b.transform),
      filamentToTool: Array.isArray(b.filamentToTool) ? b.filamentToTool.map(Number) : [],
      send: Boolean(b.send),
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

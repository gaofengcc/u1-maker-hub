import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/jobs.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import type { PlateTransform } from "@/lib/geometry.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { getUpload, uploadKind } from "@/lib/uploads.ts";
import { cleanOrient } from "@/lib/orient.ts";
import { isSourceId, resolveSite, siteForSource } from "@/lib/sites.ts";

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
  overrides?: Record<string, string>;
  plate?: number;
  transform?: { scale?: number; rotation?: number; orient?: unknown };
  filamentToTool?: number[];
  send?: boolean;
  /** Start the print right after the upload (default true). */
  print?: boolean;
  site?: string;
  source?: string;
  snapmaker?: { modelId?: string; profileId?: string };
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
  const source = isSourceId(b.source) ? b.source : undefined;
  if (b.source !== undefined && !source) return NextResponse.json({ error: "未知的模型来源。" }, { status: 400 });
  let snapmaker: { modelId: string; profileId?: string } | undefined;
  if (source === "sm-intl") {
    const { modelId, profileId } = b.snapmaker ?? {};
    const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9_-]+$/i.test(id);
    if (b.uploadId || !validId(modelId) || (profileId !== undefined && !validId(profileId))) {
      return NextResponse.json({ error: "请选择有效的 Snapmaker 模型和打印配置。" }, { status: 400 });
    }
    snapmaker = { modelId, profileId };
  }
  const upload = b.uploadId ? getUpload(String(b.uploadId)) : null;
  if (b.uploadId && !upload) return NextResponse.json({ error: "This upload no longer exists. Upload the file again." }, { status: 404 });
  if (!snapmaker && !upload && (!Number.isInteger(b.designId) || !Number.isInteger(b.instanceId))) {
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
      designId: snapmaker || upload ? 0 : b.designId!,
      instanceId: snapmaker || upload ? 0 : b.instanceId!,
      upload: upload ? { id: upload.id, name: upload.name, kind: kind! } : undefined,
      title: String(b.title ?? upload?.name ?? (snapmaker ? "Snapmaker 模型" : "MakerWorld model")).slice(0, 200),
      cover: String(b.cover ?? ""),
      mode,
      options: { ...DEFAULT_OPTIONS, ...(b.options ?? {}) },
      overrides: b.overrides,
      plate,
      transform: cleanTransform(b.transform),
      filamentToTool: Array.isArray(b.filamentToTool) ? b.filamentToTool.map(Number) : [],
      send: Boolean(b.send),
      print: !snapmaker && b.print !== false,
      site: (source && siteForSource(source)) || resolveSite(b.site),
      source,
      snapmaker,
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

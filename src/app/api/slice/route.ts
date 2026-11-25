import { NextResponse, type NextRequest } from "next/server";
import { createSliceTask } from "@/lib/sliceTasks.ts";
import { DEFAULT_OPTIONS, PRINT_MODES, type PrintMode, type PrintOptions } from "@/lib/slicer.ts";
import { readJson } from "@/lib/http.ts";

type Body = {
  instanceId?: number;
  plate?: number;
  mode?: string;
  options?: Partial<PrintOptions>;
  overrides?: Record<string, string>;
  site?: string;
};

/** 创建后台精确切片任务。单机队列由 sliceTasks 保证并发为 1。 */
export async function POST(req: NextRequest) {
  const body = await readJson<Body>(req);
  const instanceId = Number(body.instanceId ?? 0);
  const mode = body.mode as PrintMode;
  if (!Number.isInteger(instanceId) || instanceId <= 0) return NextResponse.json({ error: "模型编号无效。" }, { status: 400 });
  if (typeof mode !== "string" || !(mode in PRINT_MODES)) return NextResponse.json({ error: "切片档位无效。" }, { status: 400 });
  const task = createSliceTask({
    instanceId: Number.isInteger(instanceId) ? instanceId : 0,
    plate: Math.max(0, Math.round(Number(body.plate ?? 1)) || 0),
    mode,
    options: { ...DEFAULT_OPTIONS, ...(body.options ?? {}) },
    overrides: body.overrides ?? {},
    site: body.site ?? req.nextUrl.searchParams.get("site") ?? undefined,
  });
  return NextResponse.json(task, { status: 202 });
}

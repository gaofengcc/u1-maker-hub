import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/jobs.ts";

/**
 * Downloads a job's output: ?kind=gcode (first plate) or ?kind=3mf (sliced U1 project).
 * Add &plate=N for U1 plate N of a job printed on several plates.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/file">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind") === "3mf" ? "3mf" : "gcode";
  const plate = Number(req.nextUrl.searchParams.get("plate") ?? 0);
  const target = plate > 0 ? job.plates?.[plate - 1] : undefined;
  if (plate > 0 && !target) return NextResponse.json({ error: `This job has no plate ${plate}.` }, { status: 404 });
  const file = target ? (kind === "3mf" ? target.project : target.gcode) : kind === "3mf" ? job.files.project : job.files.gcode[0];
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "This file is not ready." }, { status: 404 });
  const stem = (job.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "model") + (target ? `_plate${plate}` : "");
  const name = kind === "3mf" ? `${stem}_U1.gcode.3mf` : `${stem}_U1${path.extname(file)}`;
  const bytes = fs.readFileSync(file);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(bytes.length),
    },
  });
}

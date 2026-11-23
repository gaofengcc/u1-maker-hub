import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/jobs.ts";
import { toolpathFor } from "@/lib/toolpath.ts";
import { meshResponseHeaders } from "@/lib/meshFile.ts";
import { errorResponse } from "@/lib/http.ts";

/** The sliced toolpaths of a job for the layer preview (see toolpath.ts). Add ?plate=N for U1 plate N. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/toolpath">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const plate = Number(req.nextUrl.searchParams.get("plate") ?? 1);
  const gcode = job.plates?.length ? job.plates[plate - 1]?.gcode : job.files.gcode[0];
  if (!gcode || !fs.existsSync(gcode)) return NextResponse.json({ error: "This job has no G-code yet." }, { status: 404 });
  try {
    const bytes = toolpathFor(gcode);
    return new NextResponse(bytes, { headers: meshResponseHeaders(bytes.length) });
  } catch (err) {
    return errorResponse(err);
  }
}

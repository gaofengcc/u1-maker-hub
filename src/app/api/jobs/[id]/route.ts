import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/jobs.ts";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({ ...job, log: job.log.slice(-40) });
}

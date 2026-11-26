import { NextResponse, type NextRequest } from "next/server";
import { getArrangeJob } from "@/lib/arrangeJobs.ts";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/arrange/[id]">) {
  const { id } = await ctx.params;
  const job = getArrangeJob(id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "摆盘任务不存在。" }, { status: 404 });
}

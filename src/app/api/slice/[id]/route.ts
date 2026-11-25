import { NextResponse } from "next/server";
import { getSliceTask } from "@/lib/sliceTasks.ts";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getSliceTask(id);
  return task ? NextResponse.json(task) : NextResponse.json({ error: "切片任务不存在。" }, { status: 404 });
}

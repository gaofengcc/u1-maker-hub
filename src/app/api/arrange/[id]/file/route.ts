import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { DATA_DIR } from "@/lib/store.ts";
import { getArrangeJob } from "@/lib/arrangeJobs.ts";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/arrange/[id]/file">) {
  const { id } = await ctx.params;
  const job = getArrangeJob(id);
  const group = Number(req.nextUrl.searchParams.get("group"));
  if (!job || job.status !== "done") return NextResponse.json({ error: "摆盘任务尚未完成。" }, { status: 404 });
  if (!Number.isInteger(group) || group < 1 || !job.result?.groups.some((entry: { index: number }) => entry.index === group)) return NextResponse.json({ error: "无效的分组编号。" }, { status: 400 });
  const file = path.join(DATA_DIR, "arrange", id, `group-${group}.3mf`);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "分组文件不存在。" }, { status: 404 });
  const bytes = fs.readFileSync(file);
  return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml", "Content-Disposition": `attachment; filename="arrange-group-${group}.3mf"`, "Content-Length": String(bytes.length) } });
}

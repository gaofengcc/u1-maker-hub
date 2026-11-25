import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { readProject } from "@/lib/threemf.ts";
import { errorResponse } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

/** 返回作者意图量，supports 字段保持兼容。 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/profile/[instanceId]">) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profile id." }, { status: 400 });
  try {
    const { file } = await downloadInstance(id, resolveSite(_req.nextUrl.searchParams.get("site")));
    const project = await readProject(file);
    return NextResponse.json({ supports: project.supports, creator: project.creator, objectOverrides: project.objectOverrides }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    return errorResponse(err);
  }
}

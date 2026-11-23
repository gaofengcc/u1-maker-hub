import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { readProject } from "@/lib/threemf.ts";
import { errorResponse } from "@/lib/http.ts";

/** What the creator set in a print profile that the U1 settings would otherwise replace: for now, supports. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/profile/[instanceId]">) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profile id." }, { status: 400 });
  try {
    const { file } = await downloadInstance(id);
    const project = await readProject(file);
    return NextResponse.json({ supports: project.supports }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    return errorResponse(err);
  }
}

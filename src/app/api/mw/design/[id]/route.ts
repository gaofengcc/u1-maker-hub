import { NextResponse, type NextRequest } from "next/server";
import { getDesign } from "@/lib/makerworld.ts";
import { errorResponse } from "@/lib/http.ts";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/mw/design/[id]">) {
  const { id } = await ctx.params;
  const designId = Number(id);
  if (!Number.isInteger(designId) || designId <= 0) return NextResponse.json({ error: "Invalid model id." }, { status: 400 });
  try {
    return NextResponse.json(await getDesign(designId));
  } catch (err) {
    return errorResponse(err);
  }
}

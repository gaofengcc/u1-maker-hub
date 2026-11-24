import { NextResponse, type NextRequest } from "next/server";
import { printJob } from "@/lib/jobs.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

/** Starts a job that is already on the printer. Body `{ plate }` picks the U1 plate of a multi-plate job (default 1). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/print">) {
  const { id } = await ctx.params;
  const b = await readJson<{ plate?: number }>(req);
  try {
    return NextResponse.json(printJob(id, Number(b.plate ?? 1)));
  } catch (err) {
    return errorResponse(err);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { sendJob } from "@/lib/jobs.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

/** Sends a sliced job to the printer. Body `{ plate }` picks the U1 plate of a multi-plate job (default 1). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/send">) {
  const { id } = await ctx.params;
  const b = await readJson<{ plate?: number }>(req);
  try {
    return NextResponse.json(sendJob(id, Number(b.plate ?? 1)));
  } catch (err) {
    return errorResponse(err);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { updateHistory, type HistoryState, type FailReason } from "@/lib/history.ts";
import { readJson } from "@/lib/http.ts";
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/history/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson<{ state?: HistoryState; failReason?: FailReason | null; note?: string }>(req);
  const result = updateHistory(id, body);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "History record not found." }, { status: 404 });
}

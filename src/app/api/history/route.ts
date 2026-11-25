import { connection, NextResponse } from "next/server";
import { listHistory, recordHistory, historyStats, type HistoryInput } from "@/lib/history.ts";
import { readJson } from "@/lib/http.ts";

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const result = listHistory({
    limit: Number(url.searchParams.get("limit") ?? 50),
    offset: Number(url.searchParams.get("offset") ?? 0),
    state: url.searchParams.get("state") ?? undefined,
    designId: url.searchParams.get("designId") ?? undefined,
  });
  return NextResponse.json({ ...result, stats: historyStats() });
}

export async function POST(req: Request) {
  const body = await readJson<HistoryInput>(req);
  try {
    return NextResponse.json(recordHistory(body), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

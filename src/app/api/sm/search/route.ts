import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/http.ts";
import { searchModels } from "@/lib/snapmaker.ts";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  try {
    const results = await searchModels({ keyword: params.get("q") ?? undefined, page, pageSize: PAGE_SIZE });
    return NextResponse.json({ ...results, next: page * PAGE_SIZE });
  } catch (err) {
    return errorResponse(err);
  }
}

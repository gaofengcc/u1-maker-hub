import { NextResponse, type NextRequest } from "next/server";
import { defaultListing, PAGE_SIZE, PERIODS, search, SORTS, type PeriodKey, type SortKey } from "@/lib/makerworld.ts";
import { errorResponse } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";
import { demoModelsForQuery } from "@/lib/demoData.ts";

/** ?q, ?sort, ?period, ?offset and ?seed (Random only). Missing or unknown values default like makerworld.com. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = p.get("q") ?? "";
  const defaults = defaultListing(q);
  const sortParam = p.get("sort") ?? "";
  const periodParam = p.get("period") ?? "";
  const sortOk = sortParam in SORTS && SORTS[sortParam as SortKey][q.trim() ? "search" : "browse"];
  const sort = (sortOk ? sortParam : defaults.sort) as SortKey;
  const period = (periodParam in PERIODS ? periodParam : defaults.period) as PeriodKey;
  const offset = Math.max(0, Number(p.get("offset") ?? 0) || 0);
  const seed = Math.max(0, Math.round(Number(p.get("seed") ?? 0)) || 0);
  if (process.env.DEMO_MODE === "1") {
    const demoItems = demoModelsForQuery(q);
    return NextResponse.json({ total: demoItems.length, items: demoItems, next: offset + PAGE_SIZE });
  }
  try {
    // `next` is the offset of the following page, even when NSFW models made this one shorter.
    return NextResponse.json({ ...(await search({ q, sort, period, offset, seed }, resolveSite(p.get("site")))), next: offset + PAGE_SIZE });
  } catch (err) {
    return errorResponse(err);
  }
}

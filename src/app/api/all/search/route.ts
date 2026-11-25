import { NextResponse, type NextRequest } from "next/server";
import { PAGE_SIZE, search } from "@/lib/makerworld.ts";
import { SOURCE_IDS, isSourceId, siteForSource, type SourceId } from "@/lib/sites.ts";
import { searchModels } from "@/lib/snapmaker.ts";
import { fromMakerWorld, fromSnapmaker, type AggregateResponse, type UnifiedCard } from "@/lib/unified.ts";
import { demoModelsForQuery } from "@/lib/demoData.ts";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "请输入搜索关键词。" }, { status: 400 });

  const sources = params.get("sources");
  const activeSources = sources === null
    ? SOURCE_IDS
    : [...new Set(sources.split(",").map((source) => source.trim()).filter(isSourceId))];
  if (process.env.DEMO_MODE === "1") {
    const demoItems = demoModelsForQuery(q).map((item) => fromMakerWorld(item, "mw-intl"));
    return NextResponse.json({
      total: demoItems.length,
      items: activeSources.length === 0 ? [] : demoItems,
      next: {},
      failures: [],
    } satisfies AggregateResponse);
  }
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  const results = await Promise.allSettled(activeSources.map(async (source) => {
    const site = siteForSource(source);
    if (site) {
      const { total, items } = await search({ q, sort: "relevance", period: "all", offset }, site);
      return { total, items: items.map((item) => fromMakerWorld(item, source)) };
    }
    // Snapmaker 搜索使用默认顺序，hot 会过滤掉部分匹配结果。
    const { total, items } = await searchModels({ keyword: q, page, pageSize: PAGE_SIZE });
    return { total, items: items.map(fromSnapmaker) };
  }));

  const response: AggregateResponse = { total: 0, items: [], next: {}, failures: [] };
  const lists: Partial<Record<SourceId, UnifiedCard[]>> = {};
  const nextOffset = offset + PAGE_SIZE;
  results.forEach((result, index) => {
    const source = activeSources[index];
    if (result.status === "rejected") {
      response.failures.push(source);
      return;
    }
    const { total, items } = result.value;
    response.total += total;
    lists[source] = items;
    if (nextOffset < total) response.next[source] = nextOffset;
  });

  const maxLen = Math.max(0, ...Object.values(lists).map((list) => list.length));
  for (let i = 0; i < maxLen; i++) {
    for (const source of activeSources) {
      const item = lists[source]?.[i];
      if (item) response.items.push(item);
    }
  }

  return NextResponse.json(response);
}

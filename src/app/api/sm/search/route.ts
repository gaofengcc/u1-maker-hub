import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/http.ts";
import { searchModels } from "@/lib/snapmaker.ts";
import { demoModelsForQuery } from "@/lib/demoData.ts";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  if (process.env.DEMO_MODE === "1") {
    const items = demoModelsForQuery(params.get("q") ?? "").map((model) => ({
      id: String(model.id),
      title: model.title,
      coverUrl: model.cover,
      creatorName: model.creator.name,
      downloadCount: model.downloads,
      likeCount: model.likes,
      collectCount: 0,
      categoryNameKey: "demo",
      isNsfw: false,
    }));
    return NextResponse.json({ total: items.length, items, next: page * PAGE_SIZE });
  }
  try {
    const results = await searchModels({ keyword: params.get("q") ?? undefined, page, pageSize: PAGE_SIZE });
    return NextResponse.json({ ...results, next: page * PAGE_SIZE });
  } catch (err) {
    return errorResponse(err);
  }
}

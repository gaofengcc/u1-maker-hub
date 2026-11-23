import { connection, NextResponse } from "next/server";
import { addFavorite, listFavorites } from "@/lib/favorites.ts";
import { readJson } from "@/lib/http.ts";
import type { ModelCard } from "@/lib/makerworld.ts";
import { resolveSite } from "@/lib/sites.ts";

export async function GET() {
  await connection();
  return NextResponse.json(listFavorites());
}

/** Saves a model. The body is the model card as shown in the app. */
export async function POST(req: Request) {
  const body = await readJson<ModelCard & { site?: string }>(req);
  const { site: rawSite, ...card } = body;
  if (!Number.isInteger(card.id) || card.id <= 0 || !card.title) {
    return NextResponse.json({ error: "Invalid model." }, { status: 400 });
  }
  return NextResponse.json(addFavorite(card, resolveSite(rawSite)));
}

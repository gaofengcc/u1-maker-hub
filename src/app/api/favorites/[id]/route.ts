import { NextResponse, type NextRequest } from "next/server";
import { removeFavorite } from "@/lib/favorites.ts";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/favorites/[id]">) {
  const { id } = await ctx.params;
  const modelId = Number(id);
  if (!Number.isInteger(modelId) || modelId <= 0) return NextResponse.json({ error: "Invalid model id." }, { status: 400 });
  return NextResponse.json(removeFavorite(modelId));
}

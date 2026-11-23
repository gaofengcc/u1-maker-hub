import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { uploadPreviewPath } from "@/lib/uploads.ts";
import { meshResponseHeaders } from "@/lib/meshFile.ts";

/** An uploaded model for the 3D preview, in the format of meshFile.ts. ?plate=N picks a plate of a 3MF. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]/mesh">) {
  const { id } = await ctx.params;
  const plate = Math.max(1, Math.round(Number(req.nextUrl.searchParams.get("plate") ?? 1)) || 1);
  const file = uploadPreviewPath(id, plate);
  if (!file) return NextResponse.json({ error: "Upload or plate not found." }, { status: 404 });
  const bytes = fs.readFileSync(file);
  return new NextResponse(bytes, { headers: meshResponseHeaders(bytes.length) });
}

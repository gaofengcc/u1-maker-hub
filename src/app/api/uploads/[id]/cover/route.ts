import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { MAX_COVER_BYTES, saveUploadCover, uploadCoverPath } from "@/lib/uploads.ts";

/** The picture of an uploaded model, when the app that sent it added one. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/uploads/[id]/cover">) {
  const { id } = await ctx.params;
  const cover = uploadCoverPath(id);
  if (!cover || !fs.existsSync(cover.file)) return NextResponse.json({ error: "No picture for this upload." }, { status: 404 });
  const bytes = fs.readFileSync(cover.file);
  return new NextResponse(bytes, { headers: { "Content-Type": cover.type, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=86400" } });
}

/** Body: the raw JPEG, PNG or WebP bytes, with their Content-Type. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]/cover">) {
  const { id } = await ctx.params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_COVER_BYTES) {
    return NextResponse.json({ error: `The picture must be under ${MAX_COVER_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }
  try {
    return NextResponse.json(saveUploadCover(id, req.headers.get("content-type") ?? "", Buffer.from(await req.arrayBuffer())));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

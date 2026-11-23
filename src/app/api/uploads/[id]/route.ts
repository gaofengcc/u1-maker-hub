import { NextResponse, type NextRequest } from "next/server";
import { deleteUpload, getUpload } from "@/lib/uploads.ts";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  const upload = getUpload(id);
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  return NextResponse.json(upload);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  deleteUpload(id);
  return NextResponse.json({ ok: true });
}

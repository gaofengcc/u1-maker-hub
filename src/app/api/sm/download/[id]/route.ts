import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/http.ts";
import { downloadProfile } from "@/lib/snapmaker.ts";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sm/download/[id]">) {
  const { id } = await ctx.params;
  const profileId = req.nextUrl.searchParams.get("profileId") ?? undefined;
  try {
    const { file, name } = await downloadProfile(id, profileId);
    const bytes = await readFile(file);
    const asciiName = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
    const encodedName = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

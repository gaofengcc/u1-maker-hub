import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { readPlateMesh } from "@/lib/geometry.ts";
import { encodeMesh, meshResponseHeaders } from "@/lib/meshFile.ts";
import { errorResponse } from "@/lib/http.ts";

/**
 * The geometry of one plate of a print profile, for the 3D preview, in the format of meshFile.ts.
 * The result is cached next to the downloaded 3MF.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/preview/[instanceId]">) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  const plate = Math.max(0, Math.round(Number(req.nextUrl.searchParams.get("plate") ?? 1)) || 0);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profile id." }, { status: 400 });
  try {
    const { file } = await downloadInstance(id);
    // Bump the version when the geometry reader changes what it returns.
    const cache = `${file}.plate${plate}.v2.mesh`;
    if (!fs.existsSync(cache)) fs.writeFileSync(cache, encodeMesh(await readPlateMesh(file, plate)));
    const bytes = fs.readFileSync(cache);
    return new NextResponse(bytes, { headers: meshResponseHeaders(bytes.length) });
  } catch (err) {
    return errorResponse(err);
  }
}

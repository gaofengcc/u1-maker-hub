import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { downloadInstance } from "@/lib/makerworld.ts";
import { errorResponse } from "@/lib/http.ts";

/** Downloads the original MakerWorld 3MF of a print profile and hands it to the browser. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/download/[instanceId]">) {
  const { instanceId } = await ctx.params;
  const id = Number(instanceId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid profile id." }, { status: 400 });
  try {
    const { file, name } = await downloadInstance(id);
    const bytes = fs.readFileSync(file);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        "Content-Disposition": `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function asciiName(name: string) {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
}

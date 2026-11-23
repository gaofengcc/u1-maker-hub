import { NextResponse } from "next/server";
import { logout, saveToken } from "@/lib/makerworld.ts";
import { publicSettings } from "@/lib/store.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

/** GET: login state. POST: save a pasted token (checked against Bambu first). DELETE: log out. */
export async function GET() {
  return NextResponse.json(publicSettings());
}

export async function POST(req: Request) {
  const { token, site } = await readJson<{ token?: string; site?: string }>(req);
  if (!token?.trim()) return NextResponse.json({ error: "Paste your token first." }, { status: 400 });
  try {
    await saveToken(token, undefined, resolveSite(site));
    return NextResponse.json(publicSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  const site = new URL(req.url).searchParams.get("site");
  logout(resolveSite(site));
  return NextResponse.json(publicSettings());
}

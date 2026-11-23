import { NextResponse } from "next/server";
import { logout, saveToken } from "@/lib/makerworld.ts";
import { publicSettings } from "@/lib/store.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

/** GET: login state. POST: save a pasted token (checked against Bambu first). DELETE: log out. */
export async function GET() {
  return NextResponse.json(publicSettings());
}

export async function POST(req: Request) {
  const { token } = await readJson<{ token?: string }>(req);
  if (!token?.trim()) return NextResponse.json({ error: "Paste your token first." }, { status: 400 });
  try {
    await saveToken(token);
    return NextResponse.json(publicSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  logout();
  return NextResponse.json(publicSettings());
}

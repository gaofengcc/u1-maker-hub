import { NextResponse } from "next/server";
import { loginWithTfa } from "@/lib/makerworld.ts";
import { errorResponse, readJson } from "@/lib/http.ts";

export async function POST(req: Request) {
  const { tfaKey, code } = await readJson<{ tfaKey?: string; code?: string }>(req);
  if (!tfaKey || !code?.trim()) return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  try {
    return NextResponse.json(await loginWithTfa(tfaKey, code.trim()));
  } catch (err) {
    return errorResponse(err);
  }
}

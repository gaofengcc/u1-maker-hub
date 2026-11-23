import { NextResponse } from "next/server";
import { loginWithTfa } from "@/lib/makerworld.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

export async function POST(req: Request) {
  const { tfaKey, code, site } = await readJson<{ tfaKey?: string; code?: string; site?: string }>(req);
  if (!tfaKey || !code?.trim()) return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  try {
    return NextResponse.json(await loginWithTfa(tfaKey, code.trim(), resolveSite(site)));
  } catch (err) {
    return errorResponse(err);
  }
}

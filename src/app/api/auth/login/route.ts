import { NextResponse } from "next/server";
import { login, loginWithCode } from "@/lib/makerworld.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

/** Email + password login. May answer with a request for an emailed code or an authenticator code. */
export async function POST(req: Request) {
  const body = await readJson<{ email?: string; password?: string; code?: string; site?: string }>(req);
  const email = body.email?.trim();
  if (!email) return NextResponse.json({ error: "Enter your Bambu account email." }, { status: 400 });
  try {
    if (body.code) return NextResponse.json(await loginWithCode(email, body.code.trim(), resolveSite(body.site)));
    if (!body.password) return NextResponse.json({ error: "Enter your password." }, { status: 400 });
    return NextResponse.json(await login(email, body.password, resolveSite(body.site)));
  } catch (err) {
    return errorResponse(err);
  }
}

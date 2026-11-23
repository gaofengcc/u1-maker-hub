import { NextResponse } from "next/server";
import { sendLoginCode } from "@/lib/makerworld.ts";
import { errorResponse, readJson } from "@/lib/http.ts";
import { resolveSite } from "@/lib/sites.ts";

/** Sends a one-time login code to the account email (passwordless login). */
export async function POST(req: Request) {
  const { email, site } = await readJson<{ email?: string; site?: string }>(req);
  if (!email?.trim()) return NextResponse.json({ error: "Enter your Bambu account email." }, { status: 400 });
  try {
    await sendLoginCode(email.trim(), resolveSite(site));
    return NextResponse.json({ status: "code", email: email.trim() });
  } catch (err) {
    return errorResponse(err);
  }
}

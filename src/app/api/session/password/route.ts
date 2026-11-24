import { NextResponse } from "next/server";
import { MIN_PASSWORD_LENGTH, passwordVersion, setPassword, verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, authSecret, signSession } from "@/lib/session";

/** 与登录同一套节流思路：同一来源 10 分钟最多错 8 次。 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

function tooMany(key: string): boolean {
  const record = attempts.get(key);
  return Boolean(record && record.resetAt > Date.now() && record.count >= MAX_ATTEMPTS);
}

function recordFailure(key: string) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else record.count += 1;
}

export async function POST(request: Request) {
  const key = clientKey(request);
  if (tooMany(key)) return NextResponse.json({ error: "尝试太频繁，请稍后再试" }, { status: 429 });

  let currentPassword = "";
  let newPassword = "";
  try {
    const body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
    currentPassword = String(body.currentPassword ?? "");
    newPassword = String(body.newPassword ?? "");
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }

  if (!verifyPassword(currentPassword)) {
    recordFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "当前密码不对" }, { status: 401 });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "新密码和当前密码一样" }, { status: 400 });
  }

  setPassword(newPassword);
  attempts.delete(key);

  // 本机保持登录：用新的密码版本号重签一份会话，其它设备上的旧会话自动失效。
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const token = await signSession(authSecret(), expiresAt, passwordVersion());
  const https =
    request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: https,
  });
  return response;
}

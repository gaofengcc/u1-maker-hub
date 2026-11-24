import { NextResponse } from "next/server";
import { passwordConfigured, passwordVersion, verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, authSecret, signSession } from "@/lib/session";

/** 简单节流：同一来源 10 分钟内最多错 8 次，防止在线爆破。 */
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
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) return false;
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    record.count += 1;
  }
}

export async function POST(request: Request) {
  if (!passwordConfigured()) {
    return NextResponse.json({ error: "服务未设置访问密码" }, { status: 503 });
  }

  const key = clientKey(request);
  if (tooMany(key)) return NextResponse.json({ error: "尝试太频繁" }, { status: 429 });

  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }

  // scrypt 比对（改过密码）/ 常量时间比对（初始密码），失败再拖慢 400ms 压住枚举。
  const ok = verifyPassword(password);
  if (!ok) {
    recordFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "密码不对" }, { status: 401 });
  }

  attempts.delete(key);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const token = await signSession(authSecret(), expiresAt, passwordVersion());
  const https = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";

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

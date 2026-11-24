import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, authSecret, readSession } from "@/lib/session";

/** 无需登录即可访问的路径：登录页本身、离线兜底页、登录接口、密码版本查询。 */
const PUBLIC_PATHS = ["/login", "/offline", "/api/session/login", "/api/session/state"];

/**
 * 当前密码版本号（pwv）。middleware 跑在 Edge Runtime 读不了文件，
 * 所以向本机 Node 侧要一次。单用户流量极小，不做内存缓存 ——
 * 缓存会让"改密码后旧会话"多活一个缓存周期，安全优先于这点开销。
 * 拿不到 pwv 就返回 null，只用签名+过期判定（fail-open），不影响可用性。
 */
async function currentPwv(): Promise<string | null> {
  try {
    const port = process.env.PORT || "3000";
    const res = await fetch(`http://127.0.0.1:${port}/api/session/state`, {
      cache: "no-store",
      headers: { "x-u1-internal": "middleware" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { pwv?: unknown };
    return typeof data.pwv === "string" ? data.pwv : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!authEnabled()) return NextResponse.next();
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSession(authSecret(), cookie);

  // 签名有效还不够：改过密码后 pwv 变化，旧会话必须一并失效。
  let authed = session.valid;
  if (authed) {
    const pwv = await currentPwv();
    if (pwv && session.pwv !== pwv) authed = false;
  }
  if (authed) return NextResponse.next();

  // API 请求返回 401，前端 fetch 能识别；页面请求跳登录页并记住来源。
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const target = `${pathname}${search}`;
  if (target && target !== "/") url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}

export const config = {
  // 静态资源、PWA 清单与 Service Worker 不走鉴权，否则安装与离线会失效。
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)"],
};

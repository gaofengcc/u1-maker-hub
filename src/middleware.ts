import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, authSecret, verifySession } from "@/lib/session";

/** 无需登录即可访问的路径：登录页本身、离线兜底页、登录接口。 */
const PUBLIC_PATHS = ["/login", "/offline", "/api/session/login"];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!authEnabled()) return NextResponse.next();
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(authSecret(), cookie)) return NextResponse.next();

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

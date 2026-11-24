"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CubeIcon, GearIcon, HeartIcon, PlateIcon, PrinterIcon, SearchIcon, UploadIcon } from "./Icons";
import { useFavorites } from "@/lib/useFavorites";
import { usePlate } from "@/lib/usePlate";
import { SITES, type SiteId } from "@/lib/sites";

type MiniStatus = { configured?: boolean; online: boolean; state?: string; progress?: number; error?: string };

const LINKS = [
  { href: "/", label: "探索", short: "探索", Icon: SearchIcon },
  { href: "/saved", label: "收藏", short: "收藏", Icon: HeartIcon },
  { href: "/plate", label: "打印盘", short: "盘", Icon: PlateIcon },
  { href: "/upload", label: "上传模型", short: "上传", Icon: UploadIcon },
  { href: "/printer", label: "我的打印机", short: "打印机", Icon: PrinterIcon },
  { href: "/settings", label: "设置", short: "设置", Icon: GearIcon },
];

export function Header() {
  const pathname = usePathname();
  const { favorites } = useFavorites();
  const { entries } = usePlate();
  const [status, setStatus] = useState<MiniStatus | null>(null);
  const [site, setSite] = useState<SiteId | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/printer/status")
        .then((r) => r.json())
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ online: false }));
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 显示设置中选定的默认 MakerWorld 站点。
  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => alive && setSite((s?.site as SiteId) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const sub = !status
    ? "检查中…"
    : status.configured === false
      ? "未配置"
      : !status.online
        ? "离线"
        : status.state === "printing"
          ? `打印中 · ${Math.round((status.progress ?? 0) * 100)}%`
          : status.state === "paused"
            ? "已暂停"
            : "就绪";

  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/model") : pathname.startsWith(href));

  // 登录页不显示主导航：点进去也只会被弹回来。注意必须在所有 hooks 之后返回，
  // 提前 return 会让 hooks 数量不一致导致 React 报错。
  if (pathname === "/login") return null;

  const counts: Record<string, [number, string]> = {
    "/saved": [favorites.length, "个收藏"],
    "/plate": [entries.length, "个在盘上"],
  };
  const savedCount = (href: string) => {
    const [n, label] = counts[href] ?? [0, ""];
    return n > 0 ? (
      <span className="nav-count" aria-label={`${n} ${label}`}>
        {n}
      </span>
    ) : null;
  };

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <span style={{ color: "var(--accent)" }}>
              <CubeIcon size={28} />
            </span>
            U1 模型工坊
          </Link>
          <span className="spacer" />
          <nav className="nav" aria-label="主导航">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
                {l.label}
                {savedCount(l.href)}
              </Link>
            ))}
          </nav>
          {site && (
            <Link href="/settings" className="chip" title="设置默认 MakerWorld 站点" aria-label={`默认 MakerWorld 站点：${SITES[site].label}`}>
              {SITES[site].label}
            </Link>
          )}
          <Link href={status?.configured === false ? "/settings" : "/printer"} className="printer-pill">
            <span className="pill-icon">
              <PrinterIcon size={16} />
            </span>
            <span className="pill-text">
              <span className="pill-title">Snapmaker U1</span>
              <span className={`pill-sub ${status?.online ? "ok" : ""}`}>{sub}</span>
            </span>
          </Link>
        </div>
      </header>
      {/* 手机上把导航放到拇指够得到的底部标签栏 */}
      <nav className="tabbar" aria-label="主导航">
        {LINKS.map(({ href, short, Icon }) => (
          <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}>
            <span className="tab-icon">
              <Icon size={22} />
              {savedCount(href)}
            </span>
            {short}
          </Link>
        ))}
      </nav>
    </>
  );
}

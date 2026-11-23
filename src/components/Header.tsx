"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CubeIcon, GearIcon, HeartIcon, PlateIcon, PrinterIcon, SearchIcon, UploadIcon } from "./Icons";
import { useFavorites } from "@/lib/useFavorites";
import { usePlate } from "@/lib/usePlate";

type MiniStatus = { configured?: boolean; online: boolean; state?: string; progress?: number; error?: string };

const LINKS = [
  { href: "/", label: "Explore", short: "Explore", Icon: SearchIcon },
  { href: "/saved", label: "Saved", short: "Saved", Icon: HeartIcon },
  { href: "/plate", label: "Plate", short: "Plate", Icon: PlateIcon },
  { href: "/upload", label: "Upload", short: "Upload", Icon: UploadIcon },
  { href: "/printer", label: "My printer", short: "Printer", Icon: PrinterIcon },
  { href: "/settings", label: "Settings", short: "Settings", Icon: GearIcon },
];

export function Header() {
  const pathname = usePathname();
  const { favorites } = useFavorites();
  const { entries } = usePlate();
  const [status, setStatus] = useState<MiniStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/printer/status")
        .then((r) => r.json())
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus({ online: false }));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const sub = !status
    ? "Checking…"
    : status.configured === false
      ? "Not set up"
      : !status.online
        ? "Offline"
        : status.state === "printing"
          ? `Printing · ${Math.round((status.progress ?? 0) * 100)}%`
          : status.state === "paused"
            ? "Paused"
            : "Ready";

  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/model") : pathname.startsWith(href));

  const counts: Record<string, [number, string]> = {
    "/saved": [favorites.length, "saved"],
    "/plate": [entries.length, "on the plate"],
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
            U1 Maker Hub
          </Link>
          <span className="spacer" />
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
                {l.label}
                {savedCount(l.href)}
              </Link>
            ))}
          </nav>
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
      {/* Phones get the same links as a bottom tab bar, within thumb reach. */}
      <nav className="tabbar" aria-label="Main">
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

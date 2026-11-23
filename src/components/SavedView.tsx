"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFavorites } from "@/lib/useFavorites";
import type { FavoriteSource, SyncState } from "@/lib/favorites.ts";
import { t } from "@/lib/i18n";
import { CardSkeleton, ModelCard } from "./ModelCard";
import { SearchIcon } from "./Icons";

const SORTS = [
  { key: "recent" },
  { key: "oldest" },
  { key: "popular" },
  { key: "title" },
] as const;

function savedAgo(iso: string, precise = false) {
  if (precise) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return t("saved.justNow");
    if (minutes < 60) return t("saved.minutesAgo", { minutes });
  }
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t("saved.today");
  if (days === 1) return t("saved.yesterday");
  if (days < 30) return t("saved.daysAgo", { days });
  return new Date(iso).toLocaleDateString();
}

const ORIGINS = [
  { key: "all" },
  { key: "app" },
  { key: "mw" },
] as const;

const SOURCE_BADGES: Record<FavoriteSource, [string, string]> = {
  app: ["", "saved.sourceApp"],
  "mw-like": ["red", "saved.sourceLiked"],
  "mw-collect": ["orange", "saved.sourceCollected"],
};

function syncLine(sync: SyncState | null, syncing: boolean) {
  if (syncing) return t("saved.syncWithMakerWorld");
  if (!sync?.syncedAt && !sync?.error) return t("saved.notSynced");
  if (sync.error) return sync.code === "login_required" || sync.code === "token_expired" ? null : t("saved.syncFailed", { error: sync.error });
  return t("saved.synced", { ago: savedAgo(sync.syncedAt!, true), liked: sync.liked, collected: sync.collected });
}

export function SavedView() {
  const { favorites, ready, sync, syncing, syncNow, sourcesOf } = useFavorites();
  const [filter, setFilter] = useState("");
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]["key"]>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("recent");
  const needsLogin = sync?.code === "login_required" || sync?.code === "token_expired";

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = favorites.filter((f) => {
      const sources = sourcesOf(f.id);
      if (origin === "app" && !sources.includes("app")) return false;
      if (origin === "mw" && !sources.some((s) => s !== "app")) return false;
      return !q || f.title.toLowerCase().includes(q) || f.creator.name.toLowerCase().includes(q);
    });
    const by = {
      recent: (a: (typeof list)[number], b: (typeof list)[number]) => b.savedAt.localeCompare(a.savedAt),
      oldest: (a: (typeof list)[number], b: (typeof list)[number]) => a.savedAt.localeCompare(b.savedAt),
      popular: (a: (typeof list)[number], b: (typeof list)[number]) => b.downloads - a.downloads,
      title: (a: (typeof list)[number], b: (typeof list)[number]) => a.title.localeCompare(b.title),
    }[sort];
    return [...list].sort(by);
    // sourcesOf reads the same list as `favorites`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, filter, origin, sort]);

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{t("saved.title")}</h1>
          {ready && <span className="muted small">{t("saved.modelCount", { count: favorites.length })}</span>}
        </div>
        {favorites.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", flex: "1 1 420px", justifyContent: "flex-end" }}>
            <label htmlFor="filter" className="sr-only">
              {t("saved.filterLabel")}
            </label>
            <div className="search" style={{ flex: "1 1 220px", maxWidth: 360 }}>
              <SearchIcon size={18} />
              <input id="filter" type="search" placeholder={t("saved.filterPlaceholder")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <label htmlFor="sort" className="sr-only">
              {t("saved.sortLabel")}
            </label>
            <select id="sort" className="select" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {t(`saved.sorts.${s.key}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="sync-bar" aria-live="polite">
        <span className="small muted" style={{ flex: 1 }}>
          {needsLogin ? (
            <>
              {t("saved.loginBefore")} <Link href="/settings">{t("saved.loginLink")}</Link>{t("saved.loginAfter")}
            </>
          ) : (
            syncLine(sync, syncing)
          )}
        </span>
        {!needsLogin && (
          <button type="button" className="btn btn-sm" onClick={syncNow} disabled={syncing}>
            {syncing ? t("saved.syncing") : t("saved.syncNow")}
          </button>
        )}
        {favorites.length > 0 && (
          <div className="chips" role="group" aria-label={t("saved.whereSaved")}>
            {ORIGINS.map((o) => (
              <button key={o.key} type="button" className="chip" aria-pressed={origin === o.key} onClick={() => setOrigin(o.key)}>
                {t(o.key === "all" ? "saved.originAll" : o.key === "app" ? "saved.originApp" : "saved.originMakerWorld")}
              </button>
            ))}
          </div>
        )}
      </section>

      {!ready ? (
        <section className="grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </section>
      ) : favorites.length === 0 ? (
        <section className="panel" style={{ maxWidth: 560 }}>
          <h2>{t("saved.emptyTitle")}</h2>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            {t("saved.emptyDescription")}
          </p>
          <Link className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
            {t("saved.explore")}
          </Link>
        </section>
      ) : shown.length === 0 ? (
        <p className="muted">{filter ? t("saved.noMatch", { filter }) : t("saved.noOrigin")}</p>
      ) : (
        <section className="grid" aria-label={t("saved.modelsAria")}>
          {shown.map((f, i) => (
            <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <ModelCard model={f} priority={i < 8} />
              <span className="source-badges" style={{ paddingLeft: 4 }}>
                {sourcesOf(f.id).map((s) => (
                  <span key={s} className={`badge ${SOURCE_BADGES[s][0]}`}>
                    {t(SOURCE_BADGES[s][1])}
                  </span>
                ))}
                <span className="small muted">
                  {sourcesOf(f.id).includes("app") ? t("saved.sourceSaved") : t("saved.sourceFound")} {savedAgo(f.savedAt)}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

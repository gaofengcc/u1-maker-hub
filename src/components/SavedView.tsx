"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFavorites } from "@/lib/useFavorites";
import type { FavoriteSource, SyncState } from "@/lib/favorites.ts";
import { CardSkeleton, ModelCard } from "./ModelCard";
import { SearchIcon } from "./Icons";

const SORTS = [
  { key: "recent", label: "Recently saved" },
  { key: "oldest", label: "Oldest first" },
  { key: "popular", label: "Most downloaded" },
  { key: "title", label: "A to Z" },
] as const;

function savedAgo(iso: string, precise = false) {
  if (precise) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
  }
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

const ORIGINS = [
  { key: "all", label: "All" },
  { key: "app", label: "Saved in the app" },
  { key: "mw", label: "From MakerWorld" },
] as const;

const SOURCE_BADGES: Record<FavoriteSource, [string, string]> = {
  app: ["", "Saved in the app"],
  "mw-like": ["red", "Liked on MakerWorld"],
  "mw-collect": ["orange", "Collected on MakerWorld"],
};

function syncLine(sync: SyncState | null, syncing: boolean) {
  if (syncing) return "Syncing with MakerWorld…";
  if (!sync?.syncedAt && !sync?.error) return "Not synced with MakerWorld yet.";
  if (sync.error) return sync.code === "login_required" || sync.code === "token_expired" ? null : `MakerWorld sync failed: ${sync.error}`;
  return `Synced with MakerWorld ${savedAgo(sync.syncedAt!, true)} · ${sync.liked} liked, ${sync.collected} collected`;
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
          <h1 style={{ margin: 0, fontSize: 24 }}>Saved for later</h1>
          {ready && <span className="muted small">{favorites.length} model{favorites.length === 1 ? "" : "s"}</span>}
        </div>
        {favorites.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", flex: "1 1 420px", justifyContent: "flex-end" }}>
            <label htmlFor="filter" className="sr-only">
              Filter saved models
            </label>
            <div className="search" style={{ flex: "1 1 220px", maxWidth: 360 }}>
              <SearchIcon size={18} />
              <input id="filter" type="search" placeholder="Filter by name or creator" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <label htmlFor="sort" className="sr-only">
              Sort
            </label>
            <select id="sort" className="select" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
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
              To bring in the models you like or collect on MakerWorld, <Link href="/settings">log in with your Bambu account</Link>.
            </>
          ) : (
            syncLine(sync, syncing)
          )}
        </span>
        {!needsLogin && (
          <button type="button" className="btn btn-sm" onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        )}
        {favorites.length > 0 && (
          <div className="chips" role="group" aria-label="Where it was saved">
            {ORIGINS.map((o) => (
              <button key={o.key} type="button" className="chip" aria-pressed={origin === o.key} onClick={() => setOrigin(o.key)}>
                {o.label}
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
          <h2>Nothing saved yet</h2>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            Tap the heart on any model while you browse, or press “Save for later” on a model page. Models you like or collect on MakerWorld show up here
            too.
          </p>
          <Link className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
            Explore models
          </Link>
        </section>
      ) : shown.length === 0 ? (
        <p className="muted">{filter ? `No saved model matches “${filter}”.` : "No saved model comes from there."}</p>
      ) : (
        <section className="grid" aria-label="Saved models">
          {shown.map((f, i) => (
            <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <ModelCard model={f} priority={i < 8} />
              <span className="source-badges" style={{ paddingLeft: 4 }}>
                {sourcesOf(f.id).map((s) => (
                  <span key={s} className={`badge ${SOURCE_BADGES[s][0]}`}>
                    {SOURCE_BADGES[s][1]}
                  </span>
                ))}
                <span className="small muted">
                  {sourcesOf(f.id).includes("app") ? "Saved" : "Found"} {savedAgo(f.savedAt)}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

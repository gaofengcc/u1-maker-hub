"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ModelCard } from "./makerworld.ts";
import type { Favorite, FavoriteSource, SyncState } from "./favorites.ts";
import type { SiteId } from "./sites.ts";

/**
 * One shared copy of the saved models for every component on the page (hearts, header count,
 * Saved page). Changes are applied at once and rolled back if the server refuses them. Once per
 * page load the list is synced with the models liked or collected on MakerWorld.
 */

type Store = { favorites: Favorite[] | null; sync: SyncState | null; syncing: boolean };

let store: Store = { favorites: null, sync: null, syncing: false };
let loading: Promise<void> | null = null;
let synced = false;
const listeners = new Set<() => void>();
const EMPTY: Favorite[] = [];

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  emit();
}

const sourcesOf = (f: Favorite): FavoriteSource[] => (f.sources?.length ? f.sources : ["app"]);
const matches = (f: Favorite, id: number, site?: SiteId) => f.id === id && (!site || f.site === site);

/** Brings in MakerWorld likes; `force` skips the server's 2-minute pause between syncs. */
async function syncNow(force = false) {
  set({ syncing: true });
  try {
    const res = await fetch(`/api/favorites/sync${force ? "?force=1" : ""}`, { method: "POST" });
    if (res.ok) {
      const body = (await res.json()) as { favorites: Favorite[]; sync: SyncState };
      set({ favorites: body.favorites, sync: body.sync });
    }
  } catch {
    /* offline: keep the list as it is */
  } finally {
    set({ syncing: false });
  }
}

function load() {
  if (store.favorites || loading) return;
  loading = fetch("/api/favorites")
    .then((r) => (r.ok ? r.json() : []))
    .then((list: Favorite[]) => set({ favorites: list }))
    .catch(() => set({ favorites: [] }))
    .finally(() => {
      loading = null;
      if (!synced) {
        synced = true;
        void syncNow();
      }
    });
}

async function save(card: ModelCard, site?: SiteId) {
  const before = store.favorites ?? [];
  const existing = before.find((f) => matches(f, card.id, site));
  const sources = [...new Set<FavoriteSource>(["app", ...(existing ? sourcesOf(existing) : [])])];
  set({ favorites: [{ ...card, site, savedAt: new Date().toISOString(), sources }, ...before.filter((f) => !matches(f, card.id, site))] });
  try {
    const res = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...card, site }) });
    if (!res.ok) throw new Error();
    set({ favorites: await res.json() });
  } catch {
    set({ favorites: before });
  }
}

/** Removes the app's save; a model liked or collected on MakerWorld stays until it is unliked there. */
async function remove(id: number, site?: SiteId) {
  const before = store.favorites ?? [];
  set({
    favorites: before.flatMap((f) => {
      if (!matches(f, id, site)) return [f];
      const rest = sourcesOf(f).filter((s) => s !== "app");
      return rest.length ? [{ ...f, sources: rest }] : [];
    }),
  });
  try {
    const res = await fetch(`/api/favorites/${id}${site ? `?site=${site}` : ""}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    set({ favorites: await res.json() });
  } catch {
    set({ favorites: before });
  }
}

export function useFavorites() {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => store,
    () => store,
  );
  useEffect(load, []);
  const list = s.favorites ?? EMPTY;
  const find = (id: number, site?: SiteId) => list.find((f) => matches(f, id, site));
  return {
    favorites: list,
    ready: s.favorites !== null,
    sync: s.sync,
    syncing: s.syncing,
    syncNow: () => syncNow(true),
    isSaved: (id: number, site?: SiteId) => Boolean(find(id, site)),
    /** Where a saved model comes from; empty when it is not saved. */
    sourcesOf: (id: number, site?: SiteId) => {
      const f = find(id, site);
      return f ? sourcesOf(f) : [];
    },
    /** Saves in the app, or removes the app's save. */
    toggle: (card: ModelCard, site?: SiteId) => {
      const favorite = find(card.id, site);
      return favorite && sourcesOf(favorite).includes("app") ? remove(card.id, site) : save(card, site);
    },
    remove,
  };
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ModelCard } from "./makerworld.ts";
import type { Favorite, FavoriteSource, SyncState } from "./favorites.ts";

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

async function save(card: ModelCard) {
  const before = store.favorites ?? [];
  const existing = before.find((f) => f.id === card.id);
  const sources = [...new Set<FavoriteSource>(["app", ...(existing ? sourcesOf(existing) : [])])];
  set({ favorites: [{ ...card, savedAt: new Date().toISOString(), sources }, ...before.filter((f) => f.id !== card.id)] });
  try {
    const res = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
    if (!res.ok) throw new Error();
    set({ favorites: await res.json() });
  } catch {
    set({ favorites: before });
  }
}

/** Removes the app's save; a model liked or collected on MakerWorld stays until it is unliked there. */
async function remove(id: number) {
  const before = store.favorites ?? [];
  set({
    favorites: before.flatMap((f) => {
      if (f.id !== id) return [f];
      const rest = sourcesOf(f).filter((s) => s !== "app");
      return rest.length ? [{ ...f, sources: rest }] : [];
    }),
  });
  try {
    const res = await fetch(`/api/favorites/${id}`, { method: "DELETE" });
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
  const find = (id: number) => list.find((f) => f.id === id);
  return {
    favorites: list,
    ready: s.favorites !== null,
    sync: s.sync,
    syncing: s.syncing,
    syncNow: () => syncNow(true),
    isSaved: (id: number) => Boolean(find(id)),
    /** Where a saved model comes from; empty when it is not saved. */
    sourcesOf: (id: number) => {
      const f = find(id);
      return f ? sourcesOf(f) : [];
    },
    /** Saves in the app, or removes the app's save. */
    toggle: (card: ModelCard) => (find(card.id) && sourcesOf(find(card.id)!).includes("app") ? remove(card.id) : save(card)),
    remove,
  };
}

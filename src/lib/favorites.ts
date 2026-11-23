import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.ts";
import type { ModelCard } from "./makerworld.ts";

/**
 * Saved models, kept in ./data/favorites.json. A snapshot of the card is stored so the list shows without calling MakerWorld.
 * A model can be saved in the app, liked (heart) on MakerWorld, collected (bookmark) on MakerWorld, or several of these.
 */

export type FavoriteSource = "app" | "mw-like" | "mw-collect";
export type Favorite = ModelCard & {
  savedAt: string;
  /** Where the model was saved; missing on saves made before MakerWorld sync, which all came from the app. */
  sources?: FavoriteSource[];
};

/** The last MakerWorld sync, shown on the Saved page. */
export type SyncState = { syncedAt: string | null; liked: number; collected: number; error: string | null; code: string | null };

const FILE = path.join(DATA_DIR, "favorites.json");
const SYNC_FILE = path.join(DATA_DIR, "favorites-sync.json");

export function sourcesOf(f: Favorite): FavoriteSource[] {
  return f.sources?.length ? f.sources : ["app"];
}

export function listFavorites(): Favorite[] {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf8")) as Favorite[];
    return Array.isArray(list) ? list.map((f) => ({ ...f, sources: sourcesOf(f) })) : [];
  } catch {
    return [];
  }
}

function write(list: Favorite[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

function snapshot(card: ModelCard): ModelCard {
  return {
    id: card.id,
    title: String(card.title ?? "").slice(0, 300),
    cover: String(card.cover ?? ""),
    creator: { name: String(card.creator?.name ?? ""), avatar: String(card.creator?.avatar ?? "") },
    downloads: Number(card.downloads) || 0,
    likes: Number(card.likes) || 0,
    prints: Number(card.prints) || 0,
    license: String(card.license ?? ""),
  };
}

/** Saves a model in the app. It keeps any MakerWorld source it already has. */
export function addFavorite(card: ModelCard): Favorite[] {
  const list = listFavorites();
  const existing = list.find((f) => f.id === card.id);
  const sources = [...new Set<FavoriteSource>(["app", ...(existing ? sourcesOf(existing) : [])])];
  write([{ ...snapshot(card), savedAt: new Date().toISOString(), sources }, ...list.filter((f) => f.id !== card.id)]);
  return listFavorites();
}

/**
 * Removes the app's save. A model also liked or collected on MakerWorld stays, labelled with that
 * source, until it is unliked there: the app never changes the MakerWorld account.
 */
export function removeFavorite(id: number): Favorite[] {
  const next = listFavorites()
    .map((f) => (f.id === id ? { ...f, sources: sourcesOf(f).filter((s) => s !== "app") } : f))
    .filter((f) => f.sources!.length > 0);
  write(next);
  return listFavorites();
}

/**
 * Brings the saved list in line with the account's MakerWorld likes and collected models: new ones are
 * added, their cards refreshed, and a MakerWorld source is dropped once the model is no longer liked or
 * collected there. App saves are never touched.
 */
export function mergeMakerWorld(likes: ModelCard[], collects: ModelCard[]): Favorite[] {
  const now = new Date().toISOString();
  const mw = new Map<number, { card: ModelCard; sources: FavoriteSource[] }>();
  for (const [cards, source] of [
    [likes, "mw-like"],
    [collects, "mw-collect"],
  ] as const) {
    for (const card of cards) {
      const entry = mw.get(card.id) ?? { card, sources: [] };
      entry.sources.push(source);
      mw.set(card.id, entry);
    }
  }
  const list = listFavorites();
  const kept = list
    .map((f) => {
      const fromMw = mw.get(f.id);
      const sources = [...sourcesOf(f).filter((s) => s === "app"), ...(fromMw?.sources ?? [])];
      return { ...f, ...(fromMw ? snapshot(fromMw.card) : {}), sources };
    })
    .filter((f) => f.sources.length > 0);
  const known = new Set(list.map((f) => f.id));
  // New on MakerWorld: first seen now, in the order MakerWorld lists them (newest first).
  const added = [...mw.values()].filter((e) => !known.has(e.card.id)).map((e) => ({ ...snapshot(e.card), savedAt: now, sources: e.sources }));
  write([...added, ...kept]);
  return listFavorites();
}

export function readSyncState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(SYNC_FILE, "utf8")) as SyncState;
  } catch {
    return { syncedAt: null, liked: 0, collected: 0, error: null, code: null };
  }
}

export function writeSyncState(state: SyncState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SYNC_FILE, JSON.stringify(state, null, 2));
}

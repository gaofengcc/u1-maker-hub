"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PlateChange, PlateEntry } from "./plate.ts";

/**
 * One shared copy of the plate for every component on the page (header count, model page, Plate
 * page). Changes are applied at once and rolled back if the server refuses them.
 */

export type NewPlateEntry = Omit<PlateEntry, "id" | "addedAt">;

let entries: PlateEntry[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const EMPTY: PlateEntry[] = [];
const NOT_LOADED = null;

function emit() {
  for (const l of listeners) l();
}

function set(next: PlateEntry[]) {
  entries = next;
  emit();
}

function load() {
  if (entries || loading) return;
  loading = fetch("/api/plate")
    .then((r) => (r.ok ? r.json() : []))
    .then((list: PlateEntry[]) => set(list))
    .catch(() => set([]))
    .finally(() => {
      loading = null;
    });
}

async function send(optimistic: PlateEntry[], url: string, init: RequestInit) {
  const before = entries ?? [];
  set(optimistic);
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    if (!res.ok) throw new Error();
    set(await res.json());
    return true;
  } catch {
    set(before);
    return false;
  }
}

const add = (entry: NewPlateEntry) =>
  send([...(entries ?? []), { ...entry, id: `pending-${Date.now()}`, addedAt: new Date().toISOString() }], "/api/plate", {
    method: "POST",
    body: JSON.stringify(entry),
  });

const addMany = (list: NewPlateEntry[]) =>
  send(
    [...(entries ?? []), ...list.map((entry, i) => ({ ...entry, id: `pending-${Date.now()}-${i}`, addedAt: new Date().toISOString() }))],
    "/api/plate",
    { method: "POST", body: JSON.stringify(list) },
  );

const update = (id: string, change: PlateChange) =>
  send(
    // Shown at once; `orient: null` means "as published", which the entry stores as no orientation.
    (entries ?? []).map((e) => (e.id === id ? { ...e, ...change, orient: "orient" in change ? (change.orient ?? undefined) : e.orient } : e)),
    `/api/plate/${id}`,
    { method: "PATCH", body: JSON.stringify(change) },
  );

const remove = (id: string) =>
  send(
    (entries ?? []).filter((e) => e.id !== id),
    `/api/plate/${id}`,
    { method: "DELETE" },
  );

const clear = () => send([], "/api/plate", { method: "DELETE" });

export function usePlate() {
  // "Not loaded" is part of the snapshot, so hydration sees the same state the server rendered.
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries,
    () => NOT_LOADED,
  );
  useEffect(load, []);
  return { entries: list ?? EMPTY, ready: list !== null, add, addMany, update, remove, clear };
}

"use client";

import { useEffect, useState } from "react";
import type { PrintOptions } from "./slicer.ts";

type Supports = PrintOptions["supports"];

const cache = new Map<number, Promise<Supports>>();

function load(instanceId: number): Promise<Supports> {
  let pending = cache.get(instanceId);
  if (!pending) {
    pending = fetch(`/api/profile/${instanceId}`).then(async (res) => {
      if (!res.ok) throw new Error(`Profile ${instanceId}: ${res.status}`);
      return ((await res.json()) as { supports: Supports }).supports;
    });
    pending.catch(() => cache.delete(instanceId));
    cache.set(instanceId, pending);
  }
  return pending;
}

/**
 * The supports the creators of these print profiles used, read from their 3MF files: "auto" when any of
 * them used supports anywhere, "plate" when they all kept supports on the plate, "off" when none did,
 * and null until known (or without a Bambu login, which the download needs).
 */
export function useCreatorSupports(instanceIds: number[], enabled: boolean): Supports | null {
  const key = [...new Set(instanceIds)].sort((a, b) => a - b).join(",");
  const [result, setResult] = useState<{ key: string; supports: Supports } | null>(null);

  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    Promise.all(key.split(",").map((id) => load(Number(id))))
      .then((list) => {
        const supports: Supports = list.includes("auto") ? "auto" : list.includes("plate") ? "plate" : "off";
        if (alive) setResult({ key, supports });
      })
      .catch(() => {
        /* unknown: the option keeps its value */
      });
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  return result?.key === key ? result.supports : null;
}

/**
 * Print options where Supports follows the creator until the person picks a value themselves.
 * `value` is what to show and send; `defaults` makes the panel's reset return to the creator's choice.
 */
export function useSupportsOption(options: PrintOptions, setOptions: (o: PrintOptions) => void, creator: Supports | null, baseDefaults: PrintOptions) {
  const [choice, setChoice] = useState<Supports | null>(null);
  const value: PrintOptions = { ...options, supports: choice ?? creator ?? options.supports };
  const defaults: PrintOptions = { ...baseDefaults, supports: creator ?? baseDefaults.supports };
  const onChange = (next: PrintOptions) => {
    setOptions(next);
    if (next.supports !== value.supports) setChoice(next.supports);
  };
  return { value, defaults, onChange, forget: () => setChoice(null) };
}

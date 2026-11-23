"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ModelCard as Card } from "@/lib/makerworld.ts";
import { api } from "@/lib/format";
import { CardSkeleton, ModelCard } from "./ModelCard";
import { SearchIcon } from "./Icons";

const IDEAS = ["Multicolor keychain", "Articulated dragon", "Gridfinity", "Cable organizer", "Planter", "Phone stand", "Desk toy", "Christmas ornament"];

type Option = { key: string; label: string };
type Props = {
  query: string;
  sort: string;
  period: string;
  /** The sorts makerworld.com offers for this page: browsing or a search. */
  sorts: Option[];
  periods: Option[];
  /** What the site opens on, left out of the address. */
  defaults: { sort: string; period: string };
};

/** Models in the order makerworld.com shows them, with the same sorts and upload periods. */
export function Explore({ query: initialQuery, sort, period, sorts, periods, defaults }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Random keeps one order while loading more pages; a new visit shuffles again.
  const [seed] = useState(() => Date.now());

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ q: initialQuery, sort, period, offset: String(offset) });
        if (sort === "random") qs.set("seed", String(seed));
        const r = await api<{ total: number; items: Card[]; next: number }>(`/api/mw/search?${qs}`);
        setItems((prev) => {
          const merged = offset === 0 ? r.items : [...prev, ...r.items];
          const seen = new Set<number>();
          return merged.filter((m) => !seen.has(m.id) && seen.add(m.id));
        });
        setTotal(r.total);
        setNextOffset(r.next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [initialQuery, sort, period, seed],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0), 0);
    return () => clearTimeout(t);
  }, [load]);

  // A new search starts from the site's defaults; changing the sort or period keeps the other.
  const go = (q: string, next?: { sort?: string; period?: string }) => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (next?.sort && next.sort !== defaults.sort) qs.set("sort", next.sort);
    if (next?.period && next.period !== defaults.period) qs.set("period", next.period);
    router.push(qs.size ? `/?${qs}` : "/");
  };

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(query);
        }}
        style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
      >
        <label htmlFor="q" className="sr-only">
          Search MakerWorld
        </label>
        <div className="search" style={{ height: 52 }}>
          <SearchIcon size={20} />
          <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search MakerWorld models…" autoComplete="off" />
          <button type="submit" className="btn btn-primary btn-pill btn-sm" style={{ height: 40, padding: "0 20px" }}>
            Search
          </button>
        </div>
      </form>

      {!initialQuery && (
        <div className="chips" aria-label="Ideas">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => go(idea)}>
              {idea}
            </button>
          ))}
        </div>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{initialQuery ? `“${initialQuery}”` : "All models on MakerWorld"}</h1>
          {total > 0 && <span className="muted small">{total.toLocaleString()} models</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div className="chips" role="group" aria-label="Sort">
            {sorts.map((s) => (
              <button key={s.key} type="button" className="chip" aria-pressed={sort === s.key} onClick={() => go(initialQuery, { sort: s.key, period })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Uploaded within">
            {periods.map((p) => (
              <button key={p.key} type="button" className="chip" aria-pressed={period === p.key} onClick={() => go(initialQuery, { sort, period: p.key })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      <section className="grid" aria-label="Models" aria-busy={loading}>
        {items.map((m, i) => (
          <ModelCard key={m.id} model={m} priority={i < 8} />
        ))}
        {loading && Array.from({ length: items.length ? 4 : 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </section>

      {!loading && !error && items.length === 0 && <p className="muted">No models found. Try other words.</p>}

      {!loading && items.length > 0 && nextOffset < total && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button type="button" className="btn btn-pill" onClick={() => load(nextOffset)}>
            Load more
          </button>
        </div>
      )}
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelCard as Card } from "@/lib/makerworld.ts";
import { SOURCE_IDS, SOURCE_LABELS, isSourceId, siteForSource, type SourceId } from "@/lib/sites.ts";
import type { SnapmakerModelSummary } from "@/lib/snapmaker.ts";
import type { AggregateResponse, UnifiedCard } from "@/lib/unified.ts";
import { api } from "@/lib/format";
import { t, tList } from "@/lib/i18n";
import { CardSkeleton, ModelCard, SnapmakerCard, UnifiedModelCard } from "./ModelCard";
import { SearchIcon } from "./Icons";

const IDEA_QUERIES = ["Multicolor keychain", "Articulated dragon", "Gridfinity", "Cable organizer", "Planter", "Phone stand", "Desk toy", "Christmas ornament"];

type Option = { key: string; label: string };
type Props = {
  source: SourceId;
  query: string;
  sort: string;
  period: string;
  /** MakerWorld 在浏览和搜索时支持的排序方式。 */
  sorts: Option[];
  periods: Option[];
  /** 默认排序及时间范围不写入 URL。 */
  defaults: { sort: string; period: string };
};

type ListingCard = Card | SnapmakerModelSummary;

export function Explore({ source, query: initialQuery, sort, period, sorts, periods, defaults }: Props) {
  const router = useRouter();
  const searching = Boolean(initialQuery.trim());
  const site = siteForSource(source);
  const sourceName = SOURCE_LABELS[source];
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<ListingCard[]>([]);
  const [searchItems, setSearchItems] = useState<UnifiedCard[]>([]);
  const [selectedSources, setSelectedSources] = useState<SourceId[]>(() => [...SOURCE_IDS]);
  const [failures, setFailures] = useState<SourceId[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | Record<string, number>>(() => searching ? {} : 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  // 加载更多时维持同一随机顺序，重新访问时重新打乱。
  const [seed] = useState(() => Date.now());

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      const controller = searching ? new AbortController() : null;
      if (controller) {
        searchRequest.current?.abort();
        searchRequest.current = controller;
      }
      try {
        const qs = new URLSearchParams({ q: initialQuery, offset: String(offset) });
        if (controller) {
          qs.set("sources", selectedSources.join(","));
          const r = await api<AggregateResponse>(`/api/all/search?${qs}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setSearchItems((prev) => {
            const merged = offset === 0 ? r.items : [...prev, ...r.items];
            const seen = new Set<string>();
            return merged.filter((m) => !seen.has(m.key) && seen.add(m.key));
          });
          setTotal(r.total);
          setNextOffset(r.next);
          setFailures(r.failures);
          return;
        }

        if (site) {
          qs.set("site", site);
          qs.set("sort", sort);
          qs.set("period", period);
          if (sort === "random") qs.set("seed", String(seed));
        }
        const r = await api<{ total: number; items: ListingCard[]; next: number }>(`/api/${site ? "mw" : "sm"}/search?${qs}`);
        setItems((prev) => {
          const merged = offset === 0 ? r.items : [...prev, ...r.items];
          const seen = new Set<ListingCard["id"]>();
          return merged.filter((m) => !seen.has(m.id) && seen.add(m.id));
        });
        setTotal(r.total);
        setNextOffset(r.next);
      } catch (e) {
        if (!controller?.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [initialQuery, searching, selectedSources, sort, period, seed, site],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0), 0);
    return () => {
      clearTimeout(t);
      searchRequest.current?.abort();
    };
  }, [load]);

  const toggleSource = (id: SourceId) => {
    const next = selectedSources.includes(id)
      ? selectedSources.filter((selected) => selected !== id)
      : SOURCE_IDS.filter((candidate) => candidate === id || selectedSources.includes(candidate));
    if (next.length === 0) return;

    searchRequest.current?.abort();
    setSelectedSources(next);
    setSearchItems([]);
    setTotal(0);
    setNextOffset({});
    setFailures([]);
    setError(null);
    setLoading(true);
  };

  // 切换来源或提交关键词后，按所选来源的默认顺序展示。
  const go = (q: string, next?: { source?: SourceId; sort?: string; period?: string }) => {
    const qs = new URLSearchParams({ source: next?.source ?? source });
    if (q.trim()) qs.set("q", q.trim());
    if (next?.sort && next.sort !== defaults.sort) qs.set("sort", next.sort);
    if (next?.period && next.period !== defaults.period) qs.set("period", next.period);
    router.push(`/?${qs}`);
  };

  const cardCount = searching ? searchItems.length : items.length;
  // 搜索响应只为还有下一页的站点返回偏移量。
  const moreOffset = typeof nextOffset === "number"
    ? items.length > 0 && nextOffset < total ? nextOffset : undefined
    : nextOffset["mw-cn"] ?? Object.values(nextOffset)[0];
  const noResults = !loading && !error && cardCount === 0 && moreOffset === undefined
    && failures.length < selectedSources.length;

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
        {!searching && (
          <>
            <label htmlFor="model-source" className="sr-only">
              {t("explore.sourceLabel")}
            </label>
            <select
              id="model-source"
              className="select"
              style={{ width: "auto" }}
              value={source}
              onChange={(e) => {
                if (isSourceId(e.target.value)) go(query, { source: e.target.value });
              }}
            >
              {SOURCE_IDS.map((id) => <option key={id} value={id}>{SOURCE_LABELS[id]}</option>)}
            </select>
          </>
        )}
        <label htmlFor="q" className="sr-only">
          {searching ? t("explore.search") : t("explore.searchLabel", { source: sourceName })}
        </label>
        <div className="search" style={{ height: 52 }}>
          <SearchIcon size={20} />
          <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searching ? t("explore.search") : t("explore.searchPlaceholder", { source: sourceName })} autoComplete="off" />
          <button type="submit" className="btn btn-primary btn-pill btn-sm" style={{ height: 40, padding: "0 20px" }}>
            {t("explore.search")}
          </button>
        </div>
      </form>

      {searching && (
        <div>
          <div className="chips" role="group" aria-label={t("explore.sourcesLabel")} aria-describedby={selectedSources.length === 1 ? "search-sources-hint" : undefined}>
            {SOURCE_IDS.map((id) => (
              <button key={id} type="button" className="chip" aria-pressed={selectedSources.includes(id)} onClick={() => toggleSource(id)}>
                {SOURCE_LABELS[id]}
              </button>
            ))}
          </div>
          {selectedSources.length === 1 && <p id="search-sources-hint" className="muted small" role="status" style={{ margin: "8px 0 0" }}>{t("explore.sourcesHint")}</p>}
        </div>
      )}

      {!initialQuery && (
        <div className="chips" aria-label={t("explore.ideas")}>
          {tList("explore.ideasList").map((idea, i) => (
            <button key={idea} type="button" className="chip" onClick={() => go(IDEA_QUERIES[i] ?? idea)}>
              {idea}
            </button>
          ))}
        </div>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{initialQuery ? `“${initialQuery}”` : site ? t("explore.allModels", { source: sourceName }) : t("explore.featured")}</h1>
          {total > 0 && <span className="muted small">{t("explore.modelCount", { n: total.toLocaleString() })}</span>}
          {searching && (total > 0 || (!loading && !error)) && <span className="muted small">{t("explore.searchAllHint", { count: selectedSources.length })}</span>}
        </div>
        {!searching && site && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div className="chips" role="group" aria-label={t("explore.sort")}>
              {sorts.map((s) => (
                <button key={s.key} type="button" className="chip" aria-pressed={sort === s.key} onClick={() => go(initialQuery, { sort: s.key, period })}>
                  {t(`explore.sorts.${s.key}`)}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label={t("explore.uploadedWithin")}>
              {periods.map((p) => (
                <button key={p.key} type="button" className="chip" aria-pressed={period === p.key} onClick={() => go(initialQuery, { sort, period: p.key })}>
                  {t(`explore.periods.${p.key}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {error && <div className="notice error">{error}</div>}
      {searching && failures.length > 0 && (
        <div className="notice" role="status">
          {failures.map((id) => <div key={id}>{t("explore.sourceFailed", { source: SOURCE_LABELS[id] })}</div>)}
        </div>
      )}

      <section className="grid" aria-label={t("explore.models")} aria-busy={loading}>
        {searching
          ? searchItems.map((m, i) => <UnifiedModelCard key={m.key} card={m} priority={i < 8} />)
          : items.map((m, i) => "coverUrl" in m
            ? <SnapmakerCard key={m.id} model={m} priority={i < 8} />
            : <ModelCard key={m.id} model={m} site={site ?? undefined} priority={i < 8} />)}
        {loading && Array.from({ length: cardCount ? 4 : 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </section>

      {noResults && <p className="muted">{t("explore.noResults")}</p>}

      {!loading && moreOffset !== undefined && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button type="button" className="btn btn-pill" onClick={() => load(moreOffset)}>
            {t("explore.loadMore")}
          </button>
        </div>
      )}
    </main>
  );
}

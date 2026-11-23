"use client";

import type { ModelCard } from "@/lib/makerworld.ts";
import type { FavoriteSource } from "@/lib/favorites.ts";
import { useFavorites } from "@/lib/useFavorites";
import { t } from "@/lib/i18n";

function Heart({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

/** MakerWorld 上的点赞/收藏状态描述，非 MakerWorld 模型返回空串。 */
export function makerWorldLabel(sources: FavoriteSource[]) {
  const done = [
    sources.includes("mw-like") && t("fav.liked"),
    sources.includes("mw-collect") && t("fav.collected"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return done.length ? t("fav.onMakerWorld", { what: done.join(t("fav.and")) }) : "";
}

/** 点击红心的实际动作说明，取决于模型收藏在哪儿。 */
function describe(title: string, sources: FavoriteSource[]) {
  const mw = makerWorldLabel(sources);
  if (sources.includes("app")) return mw ? t("fav.savedInApp", { mw }) : t("fav.removeFromSaved", { title });
  if (mw) return t("fav.onlyOnMakerWorld", { mw });
  return t("fav.saveForLater", { title });
}

/** Round heart shown over a model card. */
export function FavoriteIcon({ card }: { card: ModelCard }) {
  const { sourcesOf, toggle } = useFavorites();
  const sources = sourcesOf(card.id);
  const saved = sources.length > 0;
  const label = describe(card.title, sources);
  return (
    <button type="button" className={`fav-icon ${saved ? "on" : ""}`} aria-pressed={saved} aria-label={label} title={label} onClick={() => toggle(card)}>
      <Heart filled={saved} size={18} />
    </button>
  );
}

/** Full-width button for the model page. */
export function FavoriteButton({ card }: { card: ModelCard }) {
  const { sourcesOf, toggle } = useFavorites();
  const sources = sourcesOf(card.id);
  const inApp = sources.includes("app");
  const mw = makerWorldLabel(sources);
  return (
    <>
      <button type="button" className={`btn fav-btn ${sources.length ? "on" : ""}`} aria-pressed={inApp} onClick={() => toggle(card)} title={describe(card.title, sources)}>
        <Heart filled={sources.length > 0} size={16} />
        {inApp ? t("fav.savedForLater") : t("fav.saveForLaterShort")}
      </button>
      {mw && <span className="small muted">{t("fav.inSaved", { mw })}</span>}
    </>
  );
}

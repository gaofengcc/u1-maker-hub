"use client";

import type { ModelCard } from "@/lib/makerworld.ts";
import type { FavoriteSource } from "@/lib/favorites.ts";
import { useFavorites } from "@/lib/useFavorites";

function Heart({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

/** "liked and collected on MakerWorld", or "" when the model is not from MakerWorld. */
export function makerWorldLabel(sources: FavoriteSource[]) {
  const done = [sources.includes("mw-like") && "liked", sources.includes("mw-collect") && "collected"].filter(Boolean);
  return done.length ? `${done.join(" and ")} on MakerWorld` : "";
}

/** What clicking the heart does, given where the model is saved. */
function describe(title: string, sources: FavoriteSource[]) {
  const mw = makerWorldLabel(sources);
  if (sources.includes("app")) return mw ? `Saved in the app and ${mw}. Click to remove the app's save.` : `Remove ${title} from saved`;
  if (mw) return `${mw[0].toUpperCase()}${mw.slice(1)}. Unlike it there to remove it, or click to also save it in the app.`;
  return `Save ${title} for later`;
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
        {inApp ? "Saved for later" : "Save for later"}
      </button>
      {mw && <span className="small muted">{`${mw[0].toUpperCase()}${mw.slice(1)}, so it is in Saved.`}</span>}
    </>
  );
}

import type { ModelCard } from "./makerworld.ts";
import type { SourceId } from "./sites.ts";
import type { SnapmakerModelSummary } from "./snapmaker.ts";

export type UnifiedCard = {
  key: string;
  source: SourceId;
  id: string;
  title: string;
  cover: string;
  creatorName: string;
  downloads: number;
  likes: number;
};

export type AggregateResponse = {
  total: number;
  items: UnifiedCard[];
  next: Record<string, number>;
  failures: SourceId[];
};

export function fromMakerWorld(card: ModelCard, source: SourceId): UnifiedCard {
  const id = String(card.id);
  return {
    key: `${source}:${id}`,
    source,
    id,
    title: card.title,
    cover: card.cover,
    creatorName: card.creator.name,
    downloads: card.downloads,
    likes: card.likes,
  };
}

export function fromSnapmaker(model: SnapmakerModelSummary): UnifiedCard {
  return {
    key: `sm-intl:${model.id}`,
    source: "sm-intl",
    id: model.id,
    title: model.title,
    cover: model.coverUrl,
    creatorName: model.creatorName,
    downloads: model.downloadCount,
    likes: model.likeCount,
  };
}

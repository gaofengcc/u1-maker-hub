import Link from "next/link";
import type { ModelCard as Card } from "@/lib/makerworld.ts";
import type { SnapmakerModelSummary } from "@/lib/snapmaker.ts";
import { sourceForSite, type SiteId } from "@/lib/sites.ts";
import type { UnifiedCard } from "@/lib/unified.ts";
import { compact, mwImage, mwSrcSet } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DownloadIcon, HeartIcon } from "./Icons";
import { FavoriteIcon } from "./FavoriteButton";

/** `priority` loads the image right away (first row of the grid); the rest load as they scroll in. */
export function ModelCard({ model, site, priority = false }: { model: Card; site?: SiteId; priority?: boolean }) {
  const href = `/model/${model.id}${site ? `?source=${sourceForSite(site)}` : ""}`;
  return (
    <div className="card-wrap">
      <ModelCardLink model={model} href={href} priority={priority} makerWorld />
      <FavoriteIcon card={model} site={site} />
    </div>
  );
}

export function SnapmakerCard({ model, priority = false }: { model: SnapmakerModelSummary; priority?: boolean }) {
  return (
    <ModelCardLink
      model={{
        title: model.title,
        cover: model.coverUrl,
        creator: { name: model.creatorName, avatar: "" },
        downloads: model.downloadCount,
        likes: model.likeCount,
      }}
      href={`/model/${encodeURIComponent(model.id)}?source=sm-intl`}
      priority={priority}
    />
  );
}

export function UnifiedModelCard({ card, priority = false }: { card: UnifiedCard; priority?: boolean }) {
  return (
    <ModelCardLink
      model={{
        title: card.title,
        cover: card.cover,
        creator: { name: card.creatorName, avatar: "" },
        downloads: card.downloads,
        likes: card.likes,
      }}
      href={`/model/${encodeURIComponent(card.id)}?source=${card.source}`}
      priority={priority}
      makerWorld={card.source !== "sm-intl"}
    />
  );
}

function ModelCardLink({ model, href, priority, makerWorld = false }: {
  model: Pick<Card, "title" | "cover" | "creator" | "downloads" | "likes">;
  href: string;
  priority: boolean;
  makerWorld?: boolean;
}) {
  return (
    <Link className="card" href={href}>
      {model.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="card-img"
          src={makerWorld ? mwImage(model.cover, 480) : model.cover}
          srcSet={makerWorld ? mwSrcSet(model.cover, [320, 480, 720]) : undefined}
          sizes="(max-width: 560px) 100vw, (max-width: 1100px) 33vw, 260px"
          width={480}
          height={360}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : <div className="card-img" aria-hidden="true" />}
      <div className="card-body">
        <span className="card-title">{model.title}</span>
        <div className="card-meta">
          <span className="creator">
            {model.creator.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mwImage(model.creator.avatar, 64)} width={22} height={22} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar" />
            )}
            <span>{model.creator.name}</span>
          </span>
          <span className="stats">
            <span title={t("model.downloads")}>
              <DownloadIcon size={13} />
              {compact(model.downloads)}
            </span>
            <span title={t("model.likes")}>
              <HeartIcon size={13} />
              {compact(model.likes)}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export function CardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div className="card-img skeleton" style={{ borderRadius: 0 }} />
      <div className="card-body">
        <div className="skeleton" style={{ height: 16 }} />
        <div className="skeleton" style={{ height: 16, width: "60%" }} />
      </div>
    </div>
  );
}

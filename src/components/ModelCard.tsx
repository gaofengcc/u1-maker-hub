import Link from "next/link";
import type { ModelCard as Card } from "@/lib/makerworld.ts";
import { compact, mwImage, mwSrcSet } from "@/lib/format";
import { DownloadIcon, HeartIcon } from "./Icons";
import { FavoriteIcon } from "./FavoriteButton";

/** `priority` loads the image right away (first row of the grid); the rest load as they scroll in. */
export function ModelCard({ model, priority = false }: { model: Card; priority?: boolean }) {
  return (
    <div className="card-wrap">
      <ModelCardLink model={model} priority={priority} />
      <FavoriteIcon card={model} />
    </div>
  );
}

function ModelCardLink({ model, priority }: { model: Card; priority: boolean }) {
  return (
    <Link className="card" href={`/model/${model.id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="card-img"
        src={mwImage(model.cover, 480)}
        srcSet={mwSrcSet(model.cover, [320, 480, 720])}
        sizes="(max-width: 560px) 100vw, (max-width: 1100px) 33vw, 260px"
        width={480}
        height={360}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
      />
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
            <span title="Downloads">
              <DownloadIcon size={13} />
              {compact(model.downloads)}
            </span>
            <span title="Likes">
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Instance, ModelDetail } from "@/lib/makerworld.ts";
import type { Job } from "@/lib/jobs.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import { sourceForSite, type SiteId } from "@/lib/sites.ts";
import { api, compact, duration, mwImage, mwSrcSet } from "@/lib/format";
import { t } from "@/lib/i18n";
import { FavoriteButton } from "./FavoriteButton";
import { PrintSetup, type ColorSlot, type Mode } from "./PrintSetup";
import { DownloadIcon, ExternalIcon, HeartIcon, PrintsIcon } from "./Icons";
import { loadPreviewMesh } from "@/lib/previewMesh";
import { useCreatorSupports } from "@/lib/useCreatorSupports";

type Props = {
  design: ModelDetail;
  site: SiteId;
  settings: { loggedIn: boolean; printerConfigured: boolean; tools: ToolLoad[] };
  modes: Mode[];
  defaults: PrintOptions;
  filamentPresets: string[];
  /** 地址栏里的 ?instance=，用于刷新/分享后还原选中的打印配置。 */
  initialInstance?: number;
  /** 除 instance 之外的原始查询串，切配置时原样保留。 */
  baseQuery?: string;
};

/** The filament slots a profile (or one plate of it) uses, numbered like in the 3MF (1-based). */
function slotsFor(instance: Instance, plate: number): ColorSlot[] {
  const plates = plate === 0 ? instance.plates : instance.plates.filter((p) => p.index === plate);
  const bySlot = new Map<number, ColorSlot>();
  for (const p of plates) {
    for (const f of p.filaments) {
      const prev = bySlot.get(f.slot);
      bySlot.set(f.slot, { slot: f.slot, color: f.color, type: f.type, grams: (prev?.grams ?? 0) + f.grams });
    }
  }
  if (bySlot.size === 0) instance.filaments.forEach((f, i) => bySlot.set(i + 1, { slot: i + 1, color: f.color, type: f.type, grams: f.grams }));
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

export function ModelView({ design, site, settings, modes, defaults, filamentPresets, initialInstance = 0, baseQuery = "" }: Props) {
  const router = useRouter();
  // 优先用地址栏里的配置；无效或缺省时回落到第一个（作者默认）配置。
  const [instanceId, setInstanceId] = useState(
    () => design.instances.find((i) => Number(i.id) === initialInstance)?.id ?? design.instances[0]?.id ?? design.defaultInstanceId,
  );
  const selectInstance = (nextId: number) => {
    setInstanceId(nextId);
    const params = new URLSearchParams(baseQuery);
    params.set("instance", String(nextId));
    // replace 而不是 push：切配置不该在浏览器历史里堆一长串记录。
    router.replace(`/model/${design.id}?${params.toString()}`, { scroll: false });
  };
  const instance = design.instances.find((i) => i.id === instanceId) ?? design.instances[0];
  const [plate, setPlate] = useState(1);
  const creatorSupports = useCreatorSupports(instance ? [{ instanceId: instance.id, site }] : [], settings.loggedIn);
  const [picture, setPicture] = useState(0);

  const slots = useMemo(() => (instance ? slotsFor(instance, instance.plates.length > 1 ? plate : 0) : []), [instance, plate]);

  const pictures = useMemo(() => {
    const list = [...(instance?.pictures ?? []), ...(instance?.plates.map((p) => p.thumbnail).filter(Boolean) ?? []), ...design.pictures];
    return [...new Set(list.length ? list : [design.cover])];
  }, [instance, design]);

  if (!instance) {
    return (
      <main className="container">
        <div className="notice error">{t("model.noProfile")}</div>
      </main>
    );
  }

  const plateCount = instance.plates.length;
  const printedPlate = plateCount > 1 ? plate : 1;
  const selectedPlate = instance.plates.find((p) => p.index === plate);
  const maxSlot = Math.max(1, ...slots.map((s) => s.slot), ...instance.plates.flatMap((p) => p.filaments.map((f) => f.slot)), instance.filaments.length);

  return (
    <main className="container">
      <nav aria-label={t("model.breadcrumb")} className="small muted" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/?source=${sourceForSite(site)}`}>{t("model.breadcrumb")}</Link>
        {design.categories[0] && (
          <>
            <span aria-hidden="true">/</span>
            <span>{design.categories[0]}</span>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--text)" }}>{design.title}</span>
      </nav>

      <PrintSetup
        settings={settings}
        modes={modes}
        defaults={defaults}
        sourceKey={`mw:${site}:${instance.id}`}
        media={
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              style={{ order: 1 }}
              className="gallery-main"
              src={mwImage(pictures[picture] ?? design.cover, 1200)}
              srcSet={mwSrcSet(pictures[picture] ?? design.cover, [800, 1200, 1600])}
              sizes="(max-width: 1000px) 100vw, 900px"
              width={1200}
              height={750}
              alt={design.title}
              fetchPriority="high"
              decoding="async"
              referrerPolicy="no-referrer"
            />
            {pictures.length > 1 && (
              <div className="thumbs" style={{ order: 1 }}>
                {pictures.slice(0, 16).map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    aria-pressed={i === picture}
                    aria-label={t("model.picture", { n: i + 1 })}
                    onClick={() => setPicture(i)}
                    // Warm the large version on hover so switching pictures feels instant.
                    onPointerEnter={() => {
                      const img = new Image();
                      img.src = mwImage(src, 1200);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mwImage(src, 160)} width={80} height={80} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </>
        }
        footer={
          (design.summary || instance.summary) && (
            <section className="panel" style={{ order: 8 }}>
              <h2>{t("model.about")}</h2>
              {instance.summary && <div className="summary" dangerouslySetInnerHTML={{ __html: instance.summary }} />}
              {design.summary && <div className="summary" dangerouslySetInnerHTML={{ __html: design.summary }} />}
            </section>
          )
        }
        header={
          <>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.25 }}>{design.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }} className="muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {design.creator.avatar && <img className="avatar" style={{ width: 28, height: 28 }} src={mwImage(design.creator.avatar, 64)} alt="" referrerPolicy="no-referrer" />}
              <span>{design.creator.name}</span>
            </div>
            <div className="small muted" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <DownloadIcon size={14} /> {compact(design.downloads)}
              </span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <HeartIcon size={14} /> {compact(design.likes)}
              </span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <PrintsIcon size={14} /> {compact(design.prints)} {t("model.prints")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="badge">{design.license || t("model.licenseUnknown")}</span>
              <a className="small" href={design.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {t("model.openMakerWorld")} <ExternalIcon size={13} />
              </a>
            </div>
            <FavoriteButton
              site={site}
              card={{
                id: design.id,
                title: design.title,
                cover: design.cover,
                creator: design.creator,
                downloads: design.downloads,
                likes: design.likes,
                prints: design.prints,
                license: design.license,
              }}
            />
          </>
        }
        source={
          <section className="panel" style={{ order: 3 }}>
            <h2>{t("model.profileTitle")}</h2>
            <p className="small muted">{t("model.profileDescription")}</p>
            <div className="profile-list" role="radiogroup" aria-label={t("model.profileLabel")}>
              {design.instances.slice(0, 8).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  role="radio"
                  aria-checked={i.id === instance.id}
                  className="profile"
                  onClick={() => {
                    selectInstance(i.id);
                    setPlate(1);
                    setPicture(0);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mwImage(i.cover || design.cover, 120)} width={56} height={56} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{i.title}</span>
                    <span className="small muted">
                      {i.printer || "Bambu"} · {duration(i.seconds)} · {Math.round(i.grams)} g · {i.plates.length || 1} {t("model.plates")}
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      {i.filaments.slice(0, 8).map((f, k) => (
                        <span key={k} className="swatch" style={{ width: 14, height: 14, background: f.color }} title={`${f.type} ${f.color}`} />
                      ))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        }
        plates={instance.plates.map((p) => ({
          index: p.index,
          label: `${t("model.plate", { n: p.index })}${p.name ? ` · ${p.name}` : ""} · ${duration(p.seconds)} · ${Math.round(p.grams)} g`,
        }))}
        plate={plate}
        onPlate={setPlate}
        slots={slots}
        filamentCount={maxSlot}
        estimate={{ label: t("model.makerWorldTime"), seconds: selectedPlate?.seconds ?? instance.seconds, grams: selectedPlate?.grams ?? instance.grams }}
        mesh={{ load: () => loadPreviewMesh(instance.id, printedPlate, site), autoShow: false, available: settings.loggedIn }}
        creatorSupports={creatorSupports}
        instanceId={instance.id}
        designId={design.id}
        site={site}
        canSlice={settings.loggedIn}
        notice={
          <>
            {!settings.loggedIn && (
              <div className="notice">
                {t("model.downloadNeedsAccount")} <Link href="/settings">{t("model.loginInSettings")}</Link>。
              </div>
            )}
            {filamentPresets.length === 0 && <div className="notice error">{t("model.profilesMissing")}</div>}
          </>
        }
        extraActions={
          <a
            className="btn"
            href={settings.loggedIn ? `/api/download/${instance.id}?site=${site}` : undefined}
            aria-disabled={!settings.loggedIn}
            style={settings.loggedIn ? undefined : { opacity: 0.55, pointerEvents: "none" }}
          >
            <DownloadIcon size={16} /> {t("model.original3mf")}
          </a>
        }
        slice={(s, opts) =>
          api<Job>("/api/jobs", {
            method: "POST",
            body: JSON.stringify({
              designId: design.id,
              instanceId: instance.id,
              site,
              title: design.title,
              cover: design.cover,
              mode: s.mode,
              options: s.options,
              overrides: s.overrides,
              plate: printedPlate,
              transform: s.transform,
              filamentToTool: s.filamentToTool,
              send: opts.send,
              print: opts.print,
            }),
          })
        }
        plateEntry={(s) => ({
          designId: design.id,
          instanceId: instance.id,
          site,
          title: design.title,
          profile: instance.title,
          cover: instance.cover || design.cover,
          plate: s.plate,
          size: Math.round(s.transform.scale * 100),
          rotation: s.transform.rotation,
          orient: s.transform.orient,
          copies: 1,
          filamentToTool: s.filamentToTool,
        })}
        />
      <ArrangeCard instanceId={instance.id} designId={design.id} enabled={settings.loggedIn} />
    </main>
  );
}

type ArrangeJob = {
  id: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  error: string | null;
  result: {
    groups: { index: number; colors: string[]; plates: number; parts: number; gramsPerPlate: number[]; minutesPerPlate: number[] }[];
    totalPlates: number;
    originalPlates: number;
    spoolChanges: number;
    keptParts: number;
    originalParts: number;
  } | null;
};

function ArrangeCard({ instanceId, designId, enabled }: { instanceId: number; designId: number; enabled: boolean }) {
  const [job, setJob] = useState<ArrangeJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) return;
    const timer = setInterval(async () => {
      try { setJob(await api<ArrangeJob>(`/api/arrange/${job.id}`)); } catch { /* 下一轮重试 */ }
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);
  async function start() {
    setBusy(true); setError(null);
    try { setJob(await api<ArrangeJob>("/api/arrange", { method: "POST", body: JSON.stringify({ instanceId, designId, mode: "palette" }) })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  const result = job?.result;
  return (
    <section className="panel mobile-sticky-actions" style={{ marginTop: 16 }}>
      <h2>{t("model.arrangeTitle")}</h2>
      <p className="small muted">{t("model.arrangeDescription")}</p>
      {!job && <button type="button" className="btn" onClick={start} disabled={!enabled || busy}>{busy ? t("model.arrangeStarting") : t("model.arrangeStart")}</button>}
      {!enabled && <p className="small muted">{t("model.downloadNeedsAccount")}</p>}
      {job && (job.status === "pending" || job.status === "running") && <div aria-live="polite"><p className="small">{t("model.arrangeProgress", { percent: job.progress })}</p><progress value={job.progress} max={100} style={{ width: "100%" }} /></div>}
      {job?.status === "error" && <div className="notice error">{job.error || t("model.arrangeFailed")}</div>}
      {result && job?.status === "done" && (
        <div style={{ overflowX: "auto" }}>
          <p className="small">{t("model.arrangeSummary", { total: result.totalPlates, original: result.originalPlates, parts: result.keptParts })} {t("model.arrangeSpoolChanges", { count: result.spoolChanges })}</p>
          <table className="responsive-table"><thead><tr><th>{t("model.arrangeGroup")}</th><th>{t("model.arrangeColors")}</th><th>{t("model.arrangePlates")}</th><th>{t("model.arrangeMaterial")}</th><th /></tr></thead><tbody>
            {result.groups.map((group) => <tr key={group.index}><td data-label={t("model.arrangeGroup")}>{group.index}</td><td data-label={t("model.arrangeColors")}>{group.colors.join("、")}</td><td data-label={t("model.arrangePlates")}>{group.plates}</td><td data-label={t("model.arrangeMaterial")}>{group.gramsPerPlate.map((grams, i) => `${Math.round(grams)}g / ${Math.round(group.minutesPerPlate[i] ?? 0)}min`).join(" · ")}</td><td data-label={t("model.arrangeDownload")}><a className="btn small" href={`/api/arrange/${job.id}/file?group=${group.index}`}>{t("model.arrangeDownload")}</a></td></tr>)}
          </tbody></table>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

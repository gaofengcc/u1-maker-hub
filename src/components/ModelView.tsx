"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Instance, ModelDetail } from "@/lib/makerworld.ts";
import type { Job } from "@/lib/jobs.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import { api, compact, duration, mwImage, mwSrcSet } from "@/lib/format";
import { FavoriteButton } from "./FavoriteButton";
import { PrintSetup, type ColorSlot, type Mode } from "./PrintSetup";
import { DownloadIcon, ExternalIcon, HeartIcon, PrintsIcon } from "./Icons";
import { loadPreviewMesh } from "@/lib/previewMesh";
import { useCreatorSupports } from "@/lib/useCreatorSupports";

type Props = {
  design: ModelDetail;
  settings: { loggedIn: boolean; printerConfigured: boolean; tools: ToolLoad[] };
  modes: Mode[];
  defaults: PrintOptions;
  filamentPresets: string[];
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

export function ModelView({ design, settings, modes, defaults, filamentPresets }: Props) {
  const [instanceId, setInstanceId] = useState(design.instances[0]?.id ?? design.defaultInstanceId);
  const instance = design.instances.find((i) => i.id === instanceId) ?? design.instances[0];
  const [plate, setPlate] = useState(1);
  const creatorSupports = useCreatorSupports(instance ? [instance.id] : [], settings.loggedIn);
  const [picture, setPicture] = useState(0);

  const slots = useMemo(() => (instance ? slotsFor(instance, instance.plates.length > 1 ? plate : 0) : []), [instance, plate]);

  const pictures = useMemo(() => {
    const list = [...(instance?.pictures ?? []), ...(instance?.plates.map((p) => p.thumbnail).filter(Boolean) ?? []), ...design.pictures];
    return [...new Set(list.length ? list : [design.cover])];
  }, [instance, design]);

  if (!instance) {
    return (
      <main className="container">
        <div className="notice error">This model has no print profile on MakerWorld.</div>
      </main>
    );
  }

  const plateCount = instance.plates.length;
  const printedPlate = plateCount > 1 ? plate : 1;
  const selectedPlate = instance.plates.find((p) => p.index === plate);
  const maxSlot = Math.max(1, ...slots.map((s) => s.slot), ...instance.plates.flatMap((p) => p.filaments.map((f) => f.slot)), instance.filaments.length);

  return (
    <main className="container">
      <nav aria-label="Breadcrumb" className="small muted" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/">Explore</Link>
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
        sourceKey={`mw:${instance.id}`}
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
                    aria-label={`Picture ${i + 1}`}
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
              <h2>About this model</h2>
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
                <PrintsIcon size={14} /> {compact(design.prints)} prints
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="badge">{design.license || "License not stated"}</span>
              <a className="small" href={design.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                Open on MakerWorld <ExternalIcon size={13} />
              </a>
            </div>
            <FavoriteButton
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
            <h2>Print profile from MakerWorld</h2>
            <p className="small muted">Creators publish several versions. Pick one: its geometry and colors are kept, its printer settings are replaced by U1 presets.</p>
            <div className="profile-list" role="radiogroup" aria-label="Print profile">
              {design.instances.slice(0, 8).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  role="radio"
                  aria-checked={i.id === instance.id}
                  className="profile"
                  onClick={() => {
                    setInstanceId(i.id);
                    setPlate(1);
                    setPicture(0);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mwImage(i.cover || design.cover, 120)} width={56} height={56} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{i.title}</span>
                    <span className="small muted">
                      {i.printer || "Bambu"} · {duration(i.seconds)} · {Math.round(i.grams)} g · {i.plates.length || 1} plate{i.plates.length > 1 ? "s" : ""}
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
          label: `Plate ${p.index}${p.name ? ` · ${p.name}` : ""} · ${duration(p.seconds)} · ${Math.round(p.grams)} g`,
        }))}
        plate={plate}
        onPlate={setPlate}
        slots={slots}
        filamentCount={maxSlot}
        estimate={{ label: "MakerWorld time", seconds: selectedPlate?.seconds ?? instance.seconds, grams: selectedPlate?.grams ?? instance.grams }}
        mesh={{ load: () => loadPreviewMesh(instance.id, printedPlate), autoShow: false, available: settings.loggedIn }}
        creatorSupports={creatorSupports}
        canSlice={settings.loggedIn}
        notice={
          <>
            {!settings.loggedIn && (
              <div className="notice">
                Downloading from MakerWorld needs your Bambu account. <Link href="/settings">Log in in Settings</Link>.
              </div>
            )}
            {filamentPresets.length === 0 && <div className="notice error">OrcaSlicer U1 profiles were not found on this computer.</div>}
          </>
        }
        extraActions={
          <a
            className="btn"
            href={settings.loggedIn ? `/api/download/${instance.id}` : undefined}
            aria-disabled={!settings.loggedIn}
            style={settings.loggedIn ? undefined : { opacity: 0.55, pointerEvents: "none" }}
          >
            <DownloadIcon size={16} /> Original 3MF
          </a>
        }
        slice={(s, send) =>
          api<Job>("/api/jobs", {
            method: "POST",
            body: JSON.stringify({
              designId: design.id,
              instanceId: instance.id,
              title: design.title,
              cover: design.cover,
              mode: s.mode,
              options: s.options,
              plate: printedPlate,
              transform: s.transform,
              filamentToTool: s.filamentToTool,
              send,
            }),
          })
        }
        plateEntry={(s) => ({
          designId: design.id,
          instanceId: instance.id,
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
    </main>
  );
}

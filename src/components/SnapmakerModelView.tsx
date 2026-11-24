"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job } from "@/lib/jobs.ts";
import type { ToolLoad } from "@/lib/slicer.ts";
import type { SnapmakerModelDetail } from "@/lib/snapmaker.ts";
import { api, compact } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DownloadIcon, HeartIcon, SendIcon } from "./Icons";
import { JobProgress } from "./PrintSetup";

type Props = {
  design: SnapmakerModelDetail;
  settings: { printerConfigured: boolean; tools: ToolLoad[] };
};

export function SnapmakerModelView({ design, settings }: Props) {
  const [picture, setPicture] = useState(0);
  const [profileId, setProfileId] = useState(design.printProfiles[0]?.id);
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pictures = [...new Set([design.coverUrl, ...design.images].filter(Boolean))];
  const profile = design.printProfiles.find((p) => p.id === profileId);
  const busy = submitting || job?.status === "running";
  const jobId = job?.status === "running" ? job.id : undefined;
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Job>(`/api/jobs/${jobId}`);
        if (active) setJob(next);
        if (next.status !== "running") return;
      } catch {
        // 状态请求失败时继续轮询正在执行的任务。
      }
      if (active) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const sliceAndUpload = async () => {
    if (!profile || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      setJob(await api<Job>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          source: "sm-intl",
          snapmaker: { modelId: design.id, profileId: profile.id },
          title: design.title,
          cover: design.coverUrl,
          send: true,
          print: false,
        }),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const download = `/api/sm/download/${encodeURIComponent(design.id)}${profile ? `?${new URLSearchParams({ profileId: profile.id })}` : ""}`;

  return (
    <main className="container">
      <nav aria-label={t("model.breadcrumb")} className="small muted" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/?source=sm-intl">Snapmaker Space</Link>
        {design.categoryNameKey && (
          <>
            <span aria-hidden="true">/</span>
            <span>{design.categoryNameKey}</span>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--text)" }}>{design.title}</span>
      </nav>

      <div className="two-col">
        <div className="col-main">
          {pictures.length > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="gallery-main" style={{ order: 1 }} src={pictures[picture]} width={1200} height={750} alt={design.title} fetchPriority="high" decoding="async" referrerPolicy="no-referrer" />
          )}
          {pictures.length > 1 && (
            <div className="thumbs" style={{ order: 1 }}>
              {pictures.map((src, i) => (
                <button key={src} type="button" aria-pressed={picture === i} aria-label={t("model.picture", { n: i + 1 })} onClick={() => setPicture(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} width={80} height={80} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
          {design.description && (
            <section className="panel" style={{ order: 8 }}>
              <h2>{t("model.about")}</h2>
              <div className="summary" dangerouslySetInnerHTML={{ __html: design.description }} />
            </section>
          )}
        </div>

        <div className="col-side">
          <section className="panel" style={{ order: 2 }}>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.25 }}>{design.title}</h1>
            <span className="muted">{design.creatorName}</span>
            <div className="stats muted">
              <span title={t("model.downloads")}><DownloadIcon size={14} /> {compact(design.downloadCount)}</span>
              <span title={t("model.likes")}><HeartIcon size={14} /> {compact(design.likeCount)}</span>
            </div>
          </section>

          <section className="panel" style={{ order: 3 }}>
            <h2>{t("snapmaker.profileTitle")}</h2>
            {profile ? (
              <>
                <label className="sr-only" htmlFor="snapmaker-profile">{t("model.profileLabel")}</label>
                <select id="snapmaker-profile" className="select" value={profile.id} disabled={busy} onChange={(e) => {
                  setProfileId(e.target.value);
                  setJob(null);
                  setError(null);
                }}>
                  {design.printProfiles.map((p) => <option key={p.id} value={p.id}>{p.title || p.fileName || t("snapmaker.profileName", { id: p.id })}</option>)}
                </select>
                {(profile.fileName || profile.fileSize > 0) && (
                  <p className="small muted">{[profile.fileName, profile.fileSize > 0 ? `${(profile.fileSize / 1024 ** 2).toFixed(1)} MB` : ""].filter(Boolean).join(" · ")}</p>
                )}
                <p className="small muted">{t("snapmaker.profileDescription")}</p>
                <button type="button" className="btn btn-primary" disabled={busy || !settings.printerConfigured} onClick={sliceAndUpload}>
                  <SendIcon size={18} /> {t("snapmaker.sliceAndUpload")}
                </button>
                {!settings.printerConfigured && <p className="small muted">{t("print.printerHint")} <Link href="/settings">{t("print.goSettings")}</Link>。</p>}
              </>
            ) : <p className="muted">{t("snapmaker.noProfile")}</p>}

            {(profile || design.fileUrl) && (
              <>
                <a className="btn" href={download}><DownloadIcon size={16} /> {t("model.original3mf")}</a>
                <p className="small muted">{t("snapmaker.authHint")}</p>
              </>
            )}
            {error && <div className="notice error" role="alert">{error}</div>}
            {job && <JobProgress job={job} printerConfigured={settings.printerConfigured} tools={settings.tools} />}
            {job?.status === "done" && job.steps.some((step) => step.key === "upload" && step.state === "done") && (
              <div className="notice ok" role="status">{t("snapmaker.uploaded")}</div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

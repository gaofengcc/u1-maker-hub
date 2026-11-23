"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/lib/jobs.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import type { Upload } from "@/lib/uploads.ts";
import { api } from "@/lib/format";
import { loadUploadMesh } from "@/lib/previewMesh";
import { PrintSetup, type ColorSlot, type Mode } from "./PrintSetup";
import { UploadIcon } from "./Icons";

type Props = {
  settings: { printerConfigured: boolean; tools: ToolLoad[] };
  modes: Mode[];
  defaults: PrintOptions;
  /** Upload to open, from ?id= in the address. */
  initialId: string | null;
};

function megabytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Sends the raw file with upload progress, which fetch cannot report. */
function sendFile(file: File, onProgress: (fraction: number) => void): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Upload);
      else reject(new Error(body?.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: the server could not be reached."));
    xhr.send(file);
  });
}

/** Upload an STL or 3MF, then the same print screen as a MakerWorld model: check, size, preset, slice, print or add to the plate. */
export function UploadView({ settings, modes, defaults, initialId }: Props) {
  const [recent, setRecent] = useState<Upload[]>([]);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A 3MF: the plate to print. */
  const [plate, setPlate] = useState(1);
  const input = useRef<HTMLInputElement>(null);

  const project = upload?.kind === "3mf" ? upload.project : undefined;
  // A 3MF has its colours; an STL has one, whose toolhead is picked by hand.
  const slots: ColorSlot[] = useMemo(() => (project ? project.filaments.map((f, i) => ({ slot: i + 1, color: f.color, type: f.type })) : [{ slot: 1 }]), [project]);

  useEffect(() => {
    api<Upload[]>("/api/uploads").then(setRecent).catch(() => {});
    if (initialId) api<Upload>(`/api/uploads/${initialId}`).then(setUpload).catch((e) => setError((e as Error).message));
  }, [initialId]);

  // Keep the address on the open upload, so a reload or the printer page link comes back to it.
  useEffect(() => {
    const url = upload ? `/upload?id=${upload.id}` : "/upload";
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [upload]);

  const open = (u: Upload | null) => {
    setUpload(u);
    setPlate(u?.project?.plates[0]?.index ?? 1);
    setError(null);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(stl|3mf)$/i.test(file.name)) {
      setError("Only STL and 3MF files can be uploaded.");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const u = await sendFile(file, setProgress);
      open(u);
      setRecent((list) => [u, ...list.filter((x) => x.id !== u.id)].slice(0, 12));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (u: Upload) => {
    await api(`/api/uploads/${u.id}`, { method: "DELETE" }).catch(() => {});
    setRecent((list) => list.filter((x) => x.id !== u.id));
    if (upload?.id === u.id) open(null);
  };

  // A 3MF is checked plate by plate.
  const report = project?.plates.find((p) => p.index === plate)?.report ?? upload?.report;

  // Above everything until a model is open, then last on phones.
  const dropzone = (
    <section className="panel" style={{ order: upload ? 8 : 1 }}>
      {/* With a model open, its name is the page title. */}
      {upload ? <h2>Upload another STL or 3MF</h2> : <h1 style={{ margin: 0, fontSize: 24 }}>Upload an STL or 3MF</h1>}
      <p className="small muted" style={{ margin: 0 }}>
        Print your own model: it is checked, shown on the U1 bed, then sliced with the same U1 presets as MakerWorld models. A 3MF project keeps its plates
        and colours.
      </p>
      <label
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void pick(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" accept=".stl,.3mf,model/stl,model/3mf" className="sr-only" disabled={progress !== null} onChange={(e) => void pick(e.target.files?.[0])} />
        <UploadIcon size={28} />
        {progress === null ? (
          <>
            <strong>Drop an STL or 3MF here or choose a file</strong>
            <span className="small muted">STL in millimetres, or a 3MF from Bambu Studio, OrcaSlicer or any app, up to 200 MB</span>
          </>
        ) : (
          <>
            <strong>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Checking the model…"}</strong>
            <progress max={1} value={progress} style={{ width: "100%" }} />
          </>
        )}
      </label>
      {error && <div className="notice error">{error}</div>}
      {recent.length > 0 && (
        <>
          <h2 style={{ marginTop: 4 }}>Recent uploads</h2>
          <ul className="upload-list">
            {recent.map((u) => (
              <li key={u.id}>
                <button type="button" className="upload-item" aria-pressed={upload?.id === u.id} onClick={() => open(u)}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                  <span className="small muted">
                    {u.kind === "3mf" ? `3MF · ${u.project?.plates.length ?? 1} plate${(u.project?.plates.length ?? 1) > 1 ? "s" : ""}` : "STL"} ·{" "}
                    {u.report.size.map((v) => v.toFixed(0)).join(" × ")} mm · {megabytes(u.bytes)}
                  </span>
                </button>
                <button type="button" className="btn btn-sm" onClick={() => remove(u)} aria-label={`Delete ${u.name}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );

  if (!upload || !report) {
    return (
      <main className="container" style={{ maxWidth: 720 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{dropzone}</div>
      </main>
    );
  }

  const cover = upload.cover ? `/api/uploads/${upload.id}/cover` : "";

  return (
    <main className="container">
      <PrintSetup
        settings={settings}
        modes={modes}
        defaults={defaults}
        sourceKey={`upload:${upload.id}`}
        media={
          cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img style={{ order: 1 }} className="gallery-main" src={cover} width={1200} height={750} alt={upload.name} decoding="async" />
          )
        }
        footer={dropzone}
        header={
          <>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.25, overflowWrap: "anywhere" }}>{upload.name}</h1>
            <p className="small muted" style={{ margin: 0 }}>
              {project
                ? `3MF project${project.printer ? ` made for ${project.printer}` : ""}. Its printer settings are replaced by U1 presets; geometry, plates and colours are kept.`
                : "STL model, printed in one colour with U1 presets."}
            </p>
            <div className="estimates">
              <div>
                <span>{project ? "Size of the plate" : "Size in the file"}</span>
                <span>{report.size.map((v) => v.toFixed(1)).join(" × ")} mm</span>
              </div>
              <div>
                <span>Volume</span>
                <span>{report.volume != null ? `${report.volume.toFixed(1)} cm³` : "—"}</span>
              </div>
              <div>
                <span>Triangles</span>
                <span>{report.triangles.toLocaleString("en")}</span>
              </div>
              <div>
                <span>File</span>
                <span>{megabytes(upload.bytes)}</span>
              </div>
            </div>
          </>
        }
        checks={report.checks}
        plates={(project?.plates ?? []).map((p) => ({
          index: p.index,
          label: `Plate ${p.index}${p.name ? ` · ${p.name}` : ""} · ${p.report.size.map((v) => v.toFixed(0)).join(" × ")} mm`,
        }))}
        plate={plate}
        onPlate={setPlate}
        slots={slots}
        filamentCount={slots.length}
        mesh={{ load: () => loadUploadMesh(upload.id, plate), autoShow: true, available: true }}
        baseSize={report.size as [number, number, number]}
        // A 3MF keeps its creator's supports, like a MakerWorld profile; an STL has none to keep.
        creatorSupports={project?.supports ?? null}
        canSlice
        slice={(s, send) =>
          api<Job>("/api/jobs", {
            method: "POST",
            body: JSON.stringify({ uploadId: upload.id, title: upload.name, mode: s.mode, options: s.options, plate: s.plate, transform: s.transform, filamentToTool: s.filamentToTool, send }),
          })
        }
        plateEntry={(s) => ({
          designId: 0,
          instanceId: 0,
          uploadId: upload.id,
          title: upload.name,
          profile: project ? "Uploaded 3MF" : "Uploaded STL",
          cover,
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

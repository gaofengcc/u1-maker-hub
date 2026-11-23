import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.ts";
import { checkStl, parseStl, stlTo3mf, type StlReport } from "./stl.ts";
import { encodeMesh } from "./meshFile.ts";
import { loadProject, plateMesh } from "./geometry.ts";
import { readProject, type ProjectInfo } from "./threemf.ts";

/**
 * Models people upload themselves, each in data/uploads/<id>/ with its check report and preview mesh:
 * a plain STL, or a 3MF project (Bambu Studio, OrcaSlicer or any 3MF) with its plates and colours.
 */

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export type UploadKind = "stl" | "3mf";

/** What a 3MF brings beyond the mesh: plates (each checked on its own), colours and the creator's supports. */
export type UploadProject = {
  printer: string;
  plates: { index: number; name: string; report: StlReport }[];
  filaments: { color: string; type: string }[];
  supports: ProjectInfo["supports"];
};

export type Upload = {
  id: string;
  name: string;
  /** Missing on uploads made before 3MF support: those are STL. */
  kind?: UploadKind;
  createdAt: string;
  bytes: number;
  /** The STL, or the first plate of a 3MF. */
  report: StlReport;
  project?: UploadProject;
  /** File name of a picture of the model (cover.jpg…), set by the app that sent it. */
  cover?: string;
  /** Which app sent it, when it was not uploaded by hand ("designer"). */
  origin?: string;
};

const COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

const dirFor = (id: string) => path.join(UPLOAD_DIR, id);
const fileName = (kind: UploadKind) => (kind === "3mf" ? "model.3mf" : "model.stl");

export function uploadKind(upload: Upload): UploadKind {
  return upload.kind ?? "stl";
}

export function isUploadId(id: string) {
  return /^[a-f0-9-]{36}$/.test(id);
}

export function kindFromName(name: string): UploadKind | null {
  return /\.stl$/i.test(name) ? "stl" : /\.3mf$/i.test(name) ? "3mf" : null;
}

/** Checks and stores an STL or 3MF. Throws a readable error when the file cannot be used at all. */
export async function saveUpload(name: string, data: Buffer, origin?: string): Promise<Upload> {
  if (data.length === 0) throw new Error("The file is empty.");
  if (data.length > MAX_UPLOAD_BYTES) throw new Error(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const kind = kindFromName(name);
  if (!kind) throw new Error("Only STL and 3MF files can be uploaded.");
  const id = crypto.randomUUID();
  const dir = dirFor(id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const file = path.join(dir, fileName(kind));
    fs.writeFileSync(file, data);
    let report: StlReport;
    let project: UploadProject | undefined;
    if (kind === "stl") {
      const mesh = parseStl(data);
      report = checkStl(mesh);
      fs.writeFileSync(path.join(dir, "preview-1.mesh"), encodeMesh(mesh));
    } else {
      project = await check3mf(file, dir, data);
      report = project.plates[0].report;
    }
    const upload: Upload = { id, name: cleanName(name), kind, createdAt: new Date().toISOString(), bytes: data.length, report, project, origin };
    fs.writeFileSync(path.join(dir, "upload.json"), JSON.stringify(upload, null, 2));
    return upload;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/** Reads a 3MF like a MakerWorld project, then checks and previews each plate on its own. */
async function check3mf(file: string, dir: string, data: Buffer): Promise<UploadProject> {
  if (data.subarray(0, 2).toString() !== "PK") throw new Error("This is not a 3MF file.");
  let info: ProjectInfo;
  let project: Awaited<ReturnType<typeof loadProject>>;
  try {
    [info, project] = await Promise.all([readProject(file), loadProject(file)]);
  } catch {
    throw new Error("This 3MF is damaged or not a 3MF project.");
  }
  const plates: UploadProject["plates"] = [];
  for (const plate of info.plates) {
    const mesh = plateMesh(project, plate.index);
    // Bambu projects can list empty plates; they cannot be printed.
    if (mesh.indices.length === 0) continue;
    plates.push({ index: plate.index, name: plate.name, report: checkStl({ ...mesh, triangleCount: mesh.indices.length / 3 }) });
    fs.writeFileSync(path.join(dir, `preview-${plate.index}.mesh`), encodeMesh(mesh));
  }
  if (!plates.length) throw new Error("This 3MF has no printable objects.");
  return {
    printer: info.printer || info.application,
    plates,
    filaments: info.filaments.map((f) => ({ color: f.color, type: f.type })),
    supports: info.supports,
  };
}

export function getUpload(id: string): Upload | null {
  if (!isUploadId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dirFor(id), "upload.json"), "utf8"));
  } catch {
    return null;
  }
}

export function listUploads(limit = 12): Upload[] {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs
    .readdirSync(UPLOAD_DIR)
    .map(getUpload)
    .filter((u): u is Upload => Boolean(u))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function deleteUpload(id: string) {
  if (getUpload(id)) fs.rmSync(dirFor(id), { recursive: true, force: true });
}

/** The uploaded file, to slice. */
export function uploadFilePath(id: string) {
  const upload = getUpload(id);
  if (!upload) throw new Error("This upload no longer exists. Upload the file again.");
  return path.join(dirFor(id), fileName(uploadKind(upload)));
}

/**
 * The upload as a 3MF project, for the plate: a 3MF as uploaded, or an STL wrapped in a minimal 3MF
 * the first time it is needed.
 */
export async function uploadProjectPath(id: string) {
  const upload = getUpload(id);
  if (!upload) throw new Error("This upload no longer exists. Upload the file again.");
  if (uploadKind(upload) === "3mf") return path.join(dirFor(id), "model.3mf");
  const file = path.join(dirFor(id), "model.3mf");
  if (!fs.existsSync(file)) fs.writeFileSync(file, await stlTo3mf(parseStl(fs.readFileSync(path.join(dirFor(id), "model.stl"))), upload.name));
  return file;
}

/** Stores a picture of the model, shown on the plate and in recent uploads. */
export function saveUploadCover(id: string, type: string, data: Buffer): Upload {
  const upload = getUpload(id);
  if (!upload) throw new Error("Upload not found.");
  const ext = COVER_TYPES[type.split(";")[0].trim()];
  if (!ext) throw new Error("The picture must be a JPEG, PNG or WebP.");
  if (!data.length || data.length > MAX_COVER_BYTES) throw new Error(`The picture must be under ${MAX_COVER_BYTES / 1024 / 1024} MB.`);
  if (upload.cover) fs.rmSync(path.join(dirFor(id), upload.cover), { force: true });
  const cover = `cover.${ext}`;
  fs.writeFileSync(path.join(dirFor(id), cover), data);
  const next = { ...upload, cover };
  fs.writeFileSync(path.join(dirFor(id), "upload.json"), JSON.stringify(next, null, 2));
  return next;
}

export function uploadCoverPath(id: string): { file: string; type: string } | null {
  const upload = getUpload(id);
  if (!upload?.cover) return null;
  const ext = upload.cover.split(".").pop()!;
  const type = Object.entries(COVER_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { file: path.join(dirFor(id), upload.cover), type };
}

/** The preview mesh of one plate (always 1 for an STL); older STL uploads kept a single preview.mesh. */
export function uploadPreviewPath(id: string, plate: number) {
  if (!getUpload(id)) return null;
  const file = path.join(dirFor(id), `preview-${plate}.mesh`);
  if (fs.existsSync(file)) return file;
  const legacy = path.join(dirFor(id), "preview.mesh");
  return plate === 1 && fs.existsSync(legacy) ? legacy : null;
}

/** A display name without the folder or extension, used as the job and printer file name. */
function cleanName(name: string) {
  const base = path.basename(name || "model").replace(/\.(stl|3mf)$/i, "").replace(/[\u0000-\u001f]/g, "").trim();
  return (base || "Uploaded model").slice(0, 120);
}

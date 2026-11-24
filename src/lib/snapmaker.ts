import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, DOWNLOAD_DIR } from "./store.ts";

const API_BASE = "https://api-models.snapmaker.com";
const AUTH_FILE = path.join(DATA_DIR, "snapmaker-auth.json");
const CACHE_DIR = path.join(DOWNLOAD_DIR, "snapmaker");
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export class SnapmakerError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: "login_required" | "token_expired" | "not_found" | "upstream" = "upstream",
  ) {
    super(message);
  }
}

function expiredToken() {
  return new SnapmakerError("Snapmaker access token 已过期或无效，请更新 data/snapmaker-auth.json。", 401, "token_expired");
}

async function call<T>(pathname: string, token?: string): Promise<T> {
  const headers = token ? { ...HEADERS, Authorization: `Bearer ${token}` } : HEADERS;
  const res = await fetch(`${API_BASE}${pathname}`, { headers, cache: "no-store" });
  const body: { code?: number; msg?: string; data?: T } | null = await res.json().catch(() => null);
  if (token && (res.status === 401 || res.status === 403 || body?.code === 401 || body?.code === 110002)) throw expiredToken();
  if (res.status === 404 || body?.code === 404) throw new SnapmakerError("Snapmaker Space 上找不到此模型。", 404, "not_found");
  if (res.ok && body?.code === 200 && body.data != null) return body.data;
  throw new SnapmakerError(body?.msg || `Snapmaker Space 请求失败（HTTP ${res.status}）。`, res.ok ? 502 : res.status);
}

// ---------- 模型浏览 ----------

export type SnapmakerModelSummary = {
  id: string;
  title: string;
  coverUrl: string;
  creatorName: string;
  downloadCount: number;
  likeCount: number;
  collectCount: number;
  categoryId?: number;
  categoryNameKey: string;
  isNsfw: boolean;
};

export type SnapmakerPrintProfile = {
  id: string;
  title: string;
  fileUrl: string;
  gcodeUrl: string;
  fileName: string;
  fileSize: number;
};

export type SnapmakerModelDetail = SnapmakerModelSummary & {
  description: string;
  images: string[];
  tags: string[];
  fileUrl: string;
  fileSize: number;
  creatorId: string;
  translatedTitle: string;
  translatedDescription: string;
  publishedAt: string;
  printProfiles: SnapmakerPrintProfile[];
};

type RawSummary = Partial<Omit<SnapmakerModelSummary, "id">> & {
  id: string | number;
  cover_url?: string;
  creator_name?: string;
  download_count?: number;
  like_count?: number;
  collect_count?: number;
  category_id?: number;
  category_name_key?: string;
  is_nsfw?: boolean;
};
type RawProfile = Partial<Omit<SnapmakerPrintProfile, "id">> & { id: string | number };
type RawModel = RawSummary & Partial<Omit<SnapmakerModelDetail, keyof SnapmakerModelSummary | "printProfiles">> & {
  printProfiles?: RawProfile[];
};
type RawListing = {
  total?: number;
  list?: RawSummary[];
};

/** 列表使用下划线字段，详情使用驼峰字段。 */
function toSummary(model: RawSummary): SnapmakerModelSummary {
  return {
    id: String(model.id),
    title: model.title ?? "",
    coverUrl: model.coverUrl ?? model.cover_url ?? "",
    creatorName: model.creatorName ?? model.creator_name ?? "",
    downloadCount: model.downloadCount ?? model.download_count ?? 0,
    likeCount: model.likeCount ?? model.like_count ?? 0,
    collectCount: model.collectCount ?? model.collect_count ?? 0,
    categoryId: model.categoryId ?? model.category_id,
    categoryNameKey: model.categoryNameKey ?? model.category_name_key ?? "",
    isNsfw: Boolean(model.isNsfw ?? model.is_nsfw),
  };
}

export async function searchModels({ keyword, page = 1, pageSize = 20 }: { keyword?: string; page?: number; pageSize?: number }): Promise<{ total: number; items: SnapmakerModelSummary[] }> {
  const q = keyword?.trim();
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) qs.set("keyword", q);
  else qs.set("sort", "hot");
  const data = await call<RawListing>(`/api/model/${q ? "list" : "featured"}?${qs}`);
  const models = data.list ?? [];
  return { total: data.total ?? models.length, items: models.map(toSummary).filter((m) => !m.isNsfw) };
}

function checkId(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new SnapmakerError("Snapmaker 模型或打印配置 ID 无效。", 400);
}

export async function getModel(id: string): Promise<SnapmakerModelDetail> {
  checkId(id);
  const model = await call<RawModel>(`/api/model/detail/${id}`);
  return {
    ...toSummary(model),
    description: model.description ?? "",
    images: model.images ?? [],
    tags: model.tags ?? [],
    fileUrl: model.fileUrl ?? "",
    fileSize: model.fileSize ?? 0,
    creatorId: model.creatorId ?? "",
    translatedTitle: model.translatedTitle ?? "",
    translatedDescription: model.translatedDescription ?? "",
    publishedAt: model.publishedAt ?? "",
    printProfiles: (model.printProfiles ?? []).map((profile) => ({
      id: String(profile.id),
      title: profile.title ?? "",
      fileUrl: profile.fileUrl ?? "",
      gcodeUrl: profile.gcodeUrl ?? "",
      fileName: profile.fileName ?? "",
      fileSize: profile.fileSize ?? 0,
    })),
  };
}

// ---------- 签名下载 ----------

function requireToken(): string {
  let auth: { access?: unknown } | null;
  try {
    auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "缺少 data/snapmaker-auth.json，请写入 Snapmaker 登录 token 后重试。"
      : "无法读取 data/snapmaker-auth.json，请检查文件权限和 JSON 格式。";
    throw new SnapmakerError(message, 403, "login_required");
  }
  const token = typeof auth?.access === "string" ? auth.access.trim() : "";
  if (!token) throw new SnapmakerError("data/snapmaker-auth.json 缺少 access token。", 403, "login_required");

  // 本地读取 JWT 有效期，令牌仍由 Snapmaker 验证。
  let exp: number | undefined;
  try {
    exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).exp;
  } catch {
    throw expiredToken();
  }
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= Date.now() / 1000) throw expiredToken();
  return token;
}

type Download = { file: string; name: string; cached: boolean };
type Link = { fileName?: string; downloadUrl?: string };
type ProfileLink = Link & { profileId: string | number };
type SignedLinks = { modelFiles?: Link[]; printProfiles?: ProfileLink[] };

function cachedDownload(file: string): Download | undefined {
  try {
    if (fs.existsSync(file)) {
      const { name } = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
      if (typeof name === "string" && name) return { file, name, cached: true };
    }
  } catch {
    // 缓存缺失或元数据损坏时重新下载。
  }
}

/** 优先下载打印配置，以保留源 3MF 内置的 U1 预设。 */
export async function downloadProfile(id: string, profileId?: string): Promise<Download> {
  checkId(id);
  if (profileId !== undefined) checkId(profileId);
  const token = requireToken();
  if (profileId !== undefined) {
    const cached = cachedDownload(path.join(CACHE_DIR, `${id}-${profileId}.3mf`));
    if (cached) return cached;
  }

  const links = await call<SignedLinks>(`/api/model/download/${id}`, token);
  const profile = profileId === undefined ? links.printProfiles?.[0] : links.printProfiles?.find((p) => String(p.profileId) === profileId);
  if (profileId !== undefined && !profile) throw new SnapmakerError("Snapmaker Space 上找不到此打印配置。", 404, "not_found");
  const selectedId = profile ? String(profile.profileId) : "model";
  checkId(selectedId);
  const file = path.join(CACHE_DIR, `${id}-${selectedId}.3mf`);
  const cached = cachedDownload(file);
  if (cached) return cached;

  const link = profile ?? links.modelFiles?.[0];
  if (!link?.downloadUrl) throw new SnapmakerError("Snapmaker Space 未返回 3MF 下载链接。", 502);
  // 签名链接有时效，立即请求文件并沿用原始 URL。
  const res = await fetch(link.downloadUrl, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new SnapmakerError(`Snapmaker 文件下载失败（HTTP ${res.status}）。`, res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 2).toString() !== "PK") throw new SnapmakerError("Snapmaker 返回的文件不是 3MF。", 502);

  const name = link.fileName || path.basename(file);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.writeFileSync(`${temporary}.json`, JSON.stringify({ name, downloadedAt: new Date().toISOString() }));
    fs.renameSync(temporary, file);
    fs.renameSync(`${temporary}.json`, `${file}.json`);
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(`${temporary}.json`, { force: true });
  }
  return { file, name, cached: false };
}

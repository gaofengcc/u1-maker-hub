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

// ---------- 登录凭据 ----------

/** Snapmaker 前端内置的公开客户端凭据，base64("mall-app:123456")，不是私密信息。 */
const OAUTH_TOKEN_URL = "https://api.snapmaker.com/api/oauth2/token";
const OAUTH_BASIC = Buffer.from("mall-app:123456").toString("base64");
/** 提前这么久就刷新，避免请求途中过期。 */
const REFRESH_AHEAD_SECONDS = 120;

type Credentials = { access: string; refresh: string };

function readCredentials(): Credentials {
  let auth: { access?: unknown; refresh?: unknown } | null;
  try {
    auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "缺少 data/snapmaker-auth.json，请写入 Snapmaker 登录 token 后重试。"
      : "无法读取 data/snapmaker-auth.json，请检查文件权限和 JSON 格式。";
    throw new SnapmakerError(message, 403, "login_required");
  }
  const access = typeof auth?.access === "string" ? auth.access.trim() : "";
  const refresh = typeof auth?.refresh === "string" ? auth.refresh.trim() : "";
  if (!access) throw new SnapmakerError("data/snapmaker-auth.json 缺少 access token。", 403, "login_required");
  return { access, refresh };
}

/** 读出 JWT 的 exp（秒）；格式不对返回 null。令牌仍由 Snapmaker 校验，这里只看有效期。 */
function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const exp = payload?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** 原子写入并收紧权限，避免留下半截文件或被别的账号读到。 */
function saveCredentials(credentials: Credentials) {
  const temporary = `${AUTH_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, AUTH_FILE);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** 同时只有一个刷新在飞，多个请求撞上过期时共用结果。 */
let refreshing: Promise<string> | null = null;

/**
 * 用 refresh_token 换新的 access_token。
 *
 * 两个坑都是实测出来的：接口只收表单编码（发 JSON 会得到 invalid_request 400），
 * 而且每次刷新都会轮换 refresh_token，新值必须立刻落盘，否则这份凭据当场作废。
 */
function refreshAccessToken(): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refresh } = readCredentials();
    if (!refresh) throw expiredToken();
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${OAUTH_BASIC}`,
        Accept: "application/json",
        "User-Agent": HEADERS["User-Agent"],
        "accept-language": "en-US,en;q=0.9",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { code?: number; data?: { access_token?: string; refresh_token?: string } }
      | null;
    const access = body?.data?.access_token;
    if (body?.code !== 200 || typeof access !== "string" || !access) throw expiredToken();
    saveCredentials({ access, refresh: body.data?.refresh_token ?? refresh });
    return access;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** 还有余量就直接用，快过期或已过期就先刷一次。 */
async function requireToken(): Promise<string> {
  const { access } = readCredentials();
  const exp = tokenExpiry(access);
  if (exp === null) throw expiredToken();
  if (exp - Date.now() / 1000 > REFRESH_AHEAD_SECONDS) return access;
  return refreshAccessToken();
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
  if (profileId !== undefined) {
    const cached = cachedDownload(path.join(CACHE_DIR, `${id}-${profileId}.3mf`));
    if (cached) return cached;
  }

  // 服务端提前作废令牌时（比如在别处登录过），刷新一次再重试，不用人工干预。
  let links: SignedLinks;
  try {
    links = await call<SignedLinks>(`/api/model/download/${id}`, await requireToken());
  } catch (err) {
    if (!(err instanceof SnapmakerError && err.code === "token_expired")) throw err;
    links = await call<SignedLinks>(`/api/model/download/${id}`, await refreshAccessToken());
  }
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

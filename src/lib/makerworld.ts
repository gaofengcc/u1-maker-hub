import fs from "node:fs";
import path from "node:path";
import { DOWNLOAD_DIR, readSettings, writeSettings } from "./store.ts";

/**
 * Client for MakerWorld's web API (reverse-engineered, unofficial).
 * Search and model pages work without an account. Downloads need the user's Bambu token.
 * The token is only ever sent to api.bambulab.com.
 */

const API = "https://api.bambulab.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class MakerWorldError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: "login_required" | "token_expired" | "captcha" | "rate_limited" | "not_found" | "upstream" = "upstream",
  ) {
    super(message);
  }
}

async function call<T>(pathname: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    ...(init.headers as Record<string, string>),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers["Content-Type"] = "application/json";

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API}${pathname}`, { ...init, headers, cache: "no-store" });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  const response = res!;
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text.slice(0, 200) };
  }
  if (response.ok) return body as T;

  const message = String(body.error ?? body.message ?? `MakerWorld answered ${response.status}`);
  if (response.status === 429) throw new MakerWorldError("MakerWorld is rate limiting us. Wait a minute and retry.", 429, "rate_limited");
  if (response.status === 418 || body.captchaId) {
    throw new MakerWorldError("Bambu asked for a captcha. Open makerworld.com in your browser, then retry in a few hours.", 418, "captcha");
  }
  if (response.status === 401) throw new MakerWorldError("Bambu did not accept your login (expired or invalid). Log in again in Settings.", 401, "token_expired");
  if (response.status === 403 && /log in/i.test(message)) {
    throw new MakerWorldError("Downloading needs your Bambu account. Log in in Settings.", 403, "login_required");
  }
  if (response.status === 404) throw new MakerWorldError("Not found on MakerWorld.", 404, "not_found");
  throw new MakerWorldError(message, response.status);
}

// ---------- Search ----------

export type ModelCard = {
  id: number;
  title: string;
  cover: string;
  creator: { name: string; avatar: string };
  downloads: number;
  likes: number;
  prints: number;
  license: string;
};

type RawHit = {
  id: number;
  title: string;
  cover: string;
  designCreator?: { name?: string; avatar?: string };
  downloadCount?: number;
  likeCount?: number;
  printCount?: number;
  license?: string;
  nsfw?: boolean;
};

function toCard(h: RawHit): ModelCard {
  return {
    id: h.id,
    title: h.title,
    cover: h.cover,
    creator: { name: h.designCreator?.name ?? "", avatar: h.designCreator?.avatar ?? "" },
    downloads: h.downloadCount ?? 0,
    likes: h.likeCount ?? 0,
    prints: h.printCount ?? 0,
    license: h.license ?? "",
  };
}

/**
 * The sorts of makerworld.com, with the orderBy its pages send. Relevance only applies to a search,
 * Random only to browsing, like on the site.
 */
export const SORTS = {
  relevance: { label: "Relevance", orderBy: "score", search: true, browse: false },
  trending: { label: "Trending", orderBy: "hotScore", search: true, browse: true },
  boosts: { label: "Boosts", orderBy: "boosts", search: true, browse: true },
  newest: { label: "Newest", orderBy: "newUploads", search: true, browse: true },
  downloads: { label: "Downloads", orderBy: "downloadCount", search: true, browse: true },
  likes: { label: "Likes", orderBy: "likeCount", search: true, browse: true },
  random: { label: "Random", orderBy: "random", search: false, browse: true },
} as const;
export type SortKey = keyof typeof SORTS;

/** Upload periods (designCreateSince). The API knows 1 and 7 days; longer values act like no limit. */
export const PERIODS = {
  day: { label: "1 Day", days: 1 },
  week: { label: "7 Days", days: 7 },
  all: { label: "All Time", days: 0 },
} as const;
export type PeriodKey = keyof typeof PERIODS;

/** What makerworld.com shows first: All Models opens on Trending over 7 days, a search on Relevance over all time. */
export function defaultListing(q: string): { sort: SortKey; period: PeriodKey } {
  return q.trim() ? { sort: "relevance", period: "all" } : { sort: "trending", period: "week" };
}

/** Results per page, as on makerworld.com, so pages line up with the site's. */
export const PAGE_SIZE = 20;

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

/**
 * A page of models, asked for like makerworld.com's All Models page (no keyword) or search page.
 * `seed` keeps a Random listing in the same order from one page to the next.
 */
export async function search(params: { q: string; sort: SortKey; period: PeriodKey; offset: number; seed?: number }) {
  const q = params.q.trim();
  const sort = SORTS[params.sort];
  const days = PERIODS[params.period].days;
  const qs = new URLSearchParams({ orderBy: sort.orderBy });
  if (q) {
    qs.set("designType", "0");
    qs.set("isFromSearchList", "false");
    qs.set("keyword", q);
  } else {
    qs.set("categories", "");
    qs.set("entrance", "list");
    qs.set("designType", "0");
  }
  if (days) qs.set("designCreateSince", String(days));
  if (params.sort === "random") qs.set("randomSeed", String(params.seed ?? 0));
  qs.set("limit", String(PAGE_SIZE));
  qs.set("offset", String(params.offset));

  // The key holds every parameter, the random seed included.
  return cached(`search:${qs}`, 5 * 60_000, async () => {
    const raw = await call<{ total?: number; hits?: RawHit[] }>(`/v1/search-service/select/design2?${qs}`);
    const hits = raw.hits ?? [];
    // NSFW models are left out, so a page can hold fewer than PAGE_SIZE.
    return { total: raw.total ?? hits.length, items: hits.filter((h) => !h.nsfw).map(toCard) };
  });
}

// ---------- Model detail ----------

export type Filament = { type: string; color: string; grams: number };
export type Plate = { index: number; name: string; thumbnail: string; seconds: number; grams: number; filaments: (Filament & { slot: number })[] };
export type Instance = {
  id: number;
  title: string;
  summary: string;
  cover: string;
  pictures: string[];
  isDefault: boolean;
  downloads: number;
  prints: number;
  rating: number;
  printer: string;
  nozzle: number;
  seconds: number;
  grams: number;
  needAms: boolean;
  filaments: Filament[];
  plates: Plate[];
  fileSize: number;
};
export type ModelDetail = ModelCard & {
  summary: string;
  tags: string[];
  categories: string[];
  pictures: string[];
  createdAt: string;
  defaultInstanceId: number;
  instances: Instance[];
  url: string;
};

type RawPlate = {
  index: number;
  name?: string;
  thumbnail?: { url?: string };
  prediction?: number;
  weight?: number;
  filaments?: { id?: string; type?: string; color?: string; usedG?: string }[];
};

type RawInstance = {
  id: number;
  title: string;
  summary?: string;
  cover?: string;
  pictures?: { url: string }[];
  isDefault?: boolean;
  downloadCount?: number;
  printCount?: number;
  score?: number;
  prediction?: number;
  weight?: number;
  needAms?: boolean;
  instanceFilaments?: { type?: string; color?: string; usedG?: string }[];
  extention?: {
    modelInfo?: {
      f3mf?: { size?: number };
      compatibility?: { devProductName?: string; nozzleDiameter?: number };
      plates?: RawPlate[];
    };
  };
};

type RawDesign = RawHit & {
  summary?: string;
  tags?: string[];
  categories?: { name: string }[];
  createTime?: string;
  slug?: string;
  defaultInstanceId: number;
  instances?: RawInstance[];
  designExtension?: { design_pictures?: { url: string }[] };
  coverUrl?: string;
};

export async function getDesign(id: number): Promise<ModelDetail> {
  return cached(`design:${id}`, 10 * 60_000, async () => {
    const d = await call<RawDesign>(`/v1/design-service/design/${id}`);
    const instances: Instance[] = (d.instances ?? []).map((i) => {
      const info = i.extention?.modelInfo;
      return {
        id: i.id,
        title: i.title,
        summary: i.summary ?? "",
        cover: i.cover ?? "",
        pictures: (i.pictures ?? []).map((p) => p.url),
        isDefault: Boolean(i.isDefault) || i.id === d.defaultInstanceId,
        downloads: i.downloadCount ?? 0,
        prints: i.printCount ?? 0,
        rating: i.score ?? 0,
        printer: info?.compatibility?.devProductName ?? "",
        nozzle: info?.compatibility?.nozzleDiameter ?? 0.4,
        seconds: i.prediction ?? (info?.plates ?? []).reduce((s, p) => s + (p.prediction ?? 0), 0),
        grams: i.weight ?? 0,
        needAms: Boolean(i.needAms),
        filaments: (i.instanceFilaments ?? []).map((f) => ({ type: f.type ?? "PLA", color: f.color ?? "#FFFFFF", grams: Number(f.usedG ?? 0) })),
        plates: (info?.plates ?? []).map((p) => ({
          index: p.index,
          name: p.name ?? "",
          thumbnail: p.thumbnail?.url ?? "",
          seconds: p.prediction ?? 0,
          grams: p.weight ?? 0,
          filaments: (p.filaments ?? []).map((f) => ({
            slot: Number(f.id ?? 1),
            type: f.type ?? "PLA",
            color: f.color ?? "#FFFFFF",
            grams: Number(f.usedG ?? 0),
          })),
        })),
        fileSize: info?.f3mf?.size ?? 0,
      };
    });
    instances.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.downloads - a.downloads);
    return {
      ...toCard({ ...d, cover: d.coverUrl ?? d.cover }),
      summary: d.summary ?? "",
      tags: d.tags ?? [],
      categories: (d.categories ?? []).map((c) => c.name),
      pictures: (d.designExtension?.design_pictures ?? []).map((p) => p.url),
      createdAt: d.createTime ?? "",
      defaultInstanceId: d.defaultInstanceId,
      instances,
      url: `https://makerworld.com/en/models/${d.id}${d.slug ? `-${d.slug}` : ""}`,
    };
  });
}

// ---------- Download ----------

function requireToken(action = "Downloading") {
  const token = readSettings().bambuToken;
  if (!token) throw new MakerWorldError(`${action} needs your Bambu account. Log in in Settings.`, 403, "login_required");
  return token;
}

// ---------- Your likes and collected models ----------

/** Pages through one of the account's lists; stops at `max` models. */
async function myList(path: string, token: string, max = 1000): Promise<ModelCard[]> {
  const cards: ModelCard[] = [];
  for (let offset = 0; offset < max; offset += 50) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await call<{ total?: number; hits?: RawHit[] }>(`${path}${sep}offset=${offset}&limit=50`, { token });
    const hits = page.hits ?? [];
    cards.push(...hits.map(toCard));
    if (hits.length < 50 || cards.length >= (page.total ?? 0)) break;
  }
  return cards;
}

/**
 * The models the account liked (heart) and collected (bookmark) on MakerWorld. These lists are
 * private: MakerWorld shows them only to their owner, so the Bambu login is needed.
 */
export async function myMakerWorldSaves(): Promise<{ likes: ModelCard[]; collects: ModelCard[] }> {
  const token = requireToken("Syncing your MakerWorld likes");
  let uid = readSettings().bambuUser?.uid;
  if (!uid) uid = (await call<{ uid?: number }>("/v1/user-service/my/profile", { token })).uid;
  if (!uid) throw new MakerWorldError("MakerWorld did not say which account this is. Log in again in Settings.", 502);
  const [likes, collects] = await Promise.all([
    myList("/v1/design-service/my/design/like", token),
    myList(`/v1/design-service/favorites/designs/${uid}`, token),
  ]);
  return { likes, collects };
}

/** Downloads the 3MF of one print profile (instance), caching it on disk. Returns the local path. */
export async function downloadInstance(instanceId: number): Promise<{ file: string; name: string; cached: boolean }> {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const file = path.join(DOWNLOAD_DIR, `${instanceId}.3mf`);
  const metaFile = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    return { file, name: meta.name, cached: true };
  }
  const token = requireToken();
  const link = await call<{ name?: string; url?: string }>(`/v1/design-service/instance/${instanceId}/f3mf?type=download`, { token });
  if (!link.url) throw new MakerWorldError("MakerWorld returned no download link for this profile.", 502);
  // The signed CDN URL expires within minutes and must be fetched byte-exact, without auth.
  const res = await fetch(link.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new MakerWorldError(`The MakerWorld file server answered ${res.status}.`, res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 2).toString() !== "PK") throw new MakerWorldError("The downloaded file is not a 3MF.", 502);
  fs.writeFileSync(file, bytes);
  const name = link.name || `${instanceId}.3mf`;
  fs.writeFileSync(metaFile, JSON.stringify({ name, downloadedAt: new Date().toISOString() }));
  return { file, name, cached: false };
}

// ---------- Bambu account ----------

type LoginResponse = { accessToken?: string; refreshToken?: string; loginType?: string; tfaKey?: string };

export type LoginStep = { status: "ok" } | { status: "code"; email: string } | { status: "tfa"; tfaKey: string };

async function finishLogin(r: LoginResponse): Promise<LoginStep> {
  if (!r.accessToken) throw new MakerWorldError("Bambu did not return a token.", 502);
  await saveToken(r.accessToken, r.refreshToken);
  return { status: "ok" };
}

export async function login(email: string, password: string): Promise<LoginStep> {
  const r = await call<LoginResponse>("/v1/user-service/user/login", {
    method: "POST",
    body: JSON.stringify({ account: email, password, apiError: "" }),
  });
  if (r.loginType === "verifyCode") {
    await sendLoginCode(email);
    return { status: "code", email };
  }
  if (r.loginType === "tfa" && r.tfaKey) return { status: "tfa", tfaKey: r.tfaKey };
  return finishLogin(r);
}

export async function sendLoginCode(email: string) {
  await call("/v1/user-service/user/sendemail/code", { method: "POST", body: JSON.stringify({ email, type: "codeLogin" }) });
}

export async function loginWithCode(email: string, code: string): Promise<LoginStep> {
  const r = await call<LoginResponse>("/v1/user-service/user/login", {
    method: "POST",
    body: JSON.stringify({ account: email, code }),
  });
  return finishLogin(r);
}

export async function loginWithTfa(tfaKey: string, code: string): Promise<LoginStep> {
  const res = await fetch("https://bambulab.com/api/sign-in/tfa", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ tfaKey, tfaCode: code }),
  });
  const body = (await res.json().catch(() => ({}))) as LoginResponse & { error?: string };
  const cookieToken = /(?:^|[;,]\s*)token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  const accessToken = body.accessToken ?? cookieToken;
  if (!res.ok || !accessToken) throw new MakerWorldError(body.error ?? "The authenticator code was refused.", res.status || 400);
  return finishLogin({ accessToken, refreshToken: body.refreshToken });
}

export async function saveToken(rawToken: string, refreshToken?: string) {
  const token = rawToken.trim().replace(/^Bearer\s+/i, "").replace(/^token=/, "");
  const profile = await call<{ uid?: number; name?: string; handle?: string; avatar?: string }>("/v1/user-service/my/profile", { token });
  writeSettings({
    bambuToken: token,
    bambuRefreshToken: refreshToken,
    bambuUser: { uid: profile.uid, name: profile.name ?? profile.handle, avatar: profile.avatar },
    tokenSavedAt: new Date().toISOString(),
  });
}

export function logout() {
  writeSettings({ bambuToken: undefined, bambuRefreshToken: undefined, bambuUser: undefined, tokenSavedAt: undefined });
}

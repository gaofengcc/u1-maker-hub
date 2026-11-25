import fs from "node:fs";
import path from "node:path";
import type { ToolLoad } from "./slicer.ts";
import type { SiteId } from "./sites.ts";
import { DEFAULT_SITE, isSiteId, resolveSite, setConfiguredSite } from "./sites.ts";

/** Local, single-user storage. Everything lives in ./data, which is git-ignored. */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const DOWNLOAD_DIR = path.join(DATA_DIR, "downloads");
export const JOB_DIR = path.join(DATA_DIR, "jobs");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export type BambuUser = { uid?: string | number; name?: string; avatar?: string };
export type BambuAccount = { token?: string; refreshToken?: string; user?: BambuUser; savedAt?: string };

export type Settings = {
  bambuToken?: string;
  bambuRefreshToken?: string;
  bambuUser?: BambuUser;
  tokenSavedAt?: string;
  site?: SiteId;
  accounts?: Partial<Record<SiteId, BambuAccount>>;
  printerHost?: string;
  haUrl?: string;
  haToken?: string;
  haPlug?: string;
  tools: ToolLoad[];
  /** 大模型解析作者说明用的接口配置；apiKey 只存在于 data/settings.json（不入库）。 */
  ai?: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  /** 上次用过的打印参数，新任务默认从这里起步（合并自公开仓库的 printDefaults）。 */
  printDefaults?: Partial<Record<string, unknown>>;
};

const DEFAULT_SETTINGS: Settings = {
  site: DEFAULT_SITE,
  tools: [
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#F5F5F0" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#1F2328" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#C62D2D" },
    { preset: "Snapmaker PLA SnapSpeed @U1", color: "#1C6FC6" },
  ],
};

function normalized(saved: Partial<Settings>): Settings {
  const accounts = { ...(saved.accounts ?? {}) };
  if (!Object.keys(accounts).length && saved.bambuToken) {
    accounts.intl = { token: saved.bambuToken, refreshToken: saved.bambuRefreshToken, user: saved.bambuUser, savedAt: saved.tokenSavedAt };
  }
  const site = isSiteId(saved.site) ? saved.site : DEFAULT_SITE;
  setConfiguredSite(site);
  return { ...DEFAULT_SETTINGS, ...saved, accounts, site, tools: saved.tools?.length === 4 ? saved.tools : DEFAULT_SETTINGS.tools };
}

export function readSettings(): Settings {
  try { return normalized(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<Settings>); }
  catch { setConfiguredSite(DEFAULT_SITE); return { ...DEFAULT_SETTINGS, accounts: {} }; }
}

export function accountOf(site?: SiteId): BambuAccount {
  const s = readSettings();
  return s.accounts?.[resolveSite(site)] ?? {};
}

export function writeAccount(site: SiteId, patch: Partial<BambuAccount>): void {
  const s = readSettings();
  const current = s.accounts?.[site] ?? {};
  writeSettings({ accounts: { ...(s.accounts ?? {}), [site]: { ...current, ...patch } } });
}

export function clearAccount(site: SiteId): void {
  const s = readSettings();
  const accounts = { ...(s.accounts ?? {}) };
  delete accounts[site];
  writeSettings({ accounts });
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const next = normalized({ ...current, ...patch, accounts: patch.accounts ? { ...(current.accounts ?? {}), ...patch.accounts } : current.accounts });
  const site = resolveSite(next.site);
  const account = next.accounts?.[site] ?? {};
  next.bambuToken = account.token;
  next.bambuRefreshToken = account.refreshToken;
  next.bambuUser = account.user;
  next.tokenSavedAt = account.savedAt;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** Settings safe to send to the browser: never the tokens themselves. */
export function publicSettings() {
  const s = readSettings();
  const accounts = Object.fromEntries((["intl", "cn"] as SiteId[]).map((id) => {
    const a = s.accounts?.[id] ?? {};
    return [id, { loggedIn: Boolean(a.token), user: a.user ?? null, savedAt: a.savedAt ?? null }];
  }));
  const current = accounts[s.site ?? DEFAULT_SITE] as { loggedIn: boolean; user: BambuUser | null; savedAt: string | null };
  return {
    site: s.site ?? DEFAULT_SITE,
    accounts,
    loggedIn: current.loggedIn,
    bambuUser: current.user,
    tokenSavedAt: current.savedAt,
    printerHost: s.printerHost ?? "",
    haUrl: s.haUrl ?? "",
    haPlug: s.haPlug ?? "",
    haTokenSet: Boolean(s.haToken),
    tools: s.tools,
    // AI 配置只回传"是否已设置 key"，绝不把 key 发到浏览器。
    aiEnabled: s.ai?.enabled !== false,
    aiBaseUrl: s.ai?.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.deepseek.com/v1",
    aiModel: s.ai?.model ?? process.env.AI_MODEL ?? "deepseek-v4-flash",
    aiKeySet: Boolean(s.ai?.apiKey || process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY),
  };
}


// Initialize the process-local site fallback for callers that resolve a site before their first settings read.
readSettings();

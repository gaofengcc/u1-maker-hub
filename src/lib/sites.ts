export type SiteId = "intl" | "cn";
export type SiteConfig = {
  id: SiteId;
  label: string;
  apiBase: string;
  webBase: string;
  tfaUrl: string;
  cdnHosts: string[];
  acceptLanguage: string;
};

export const SITES: Record<SiteId, SiteConfig> = {
  intl: { id: "intl", label: "国际站", apiBase: "https://api.bambulab.com", webBase: "https://makerworld.com", tfaUrl: "https://bambulab.com/api/sign-in/tfa", cdnHosts: ["makerworld.bblmw.com", "public-cdn.bblmw.com"], acceptLanguage: "en-US,en;q=0.9" },
  cn: { id: "cn", label: "中国站", apiBase: "https://api.bambulab.cn", webBase: "https://makerworld.com.cn", tfaUrl: "https://bambulab.cn/api/sign-in/tfa", cdnHosts: ["makerworld.bblmw.cn", "public-cdn.bblmw.cn"], acceptLanguage: "zh-CN,zh;q=0.9" },
};
export const SITE_IDS: SiteId[] = ["intl", "cn"];
export const DEFAULT_SITE: SiteId = "cn";
let configuredSite: SiteId = DEFAULT_SITE;
export function setConfiguredSite(site: SiteId) { configuredSite = site; }
export function isSiteId(v: unknown): v is SiteId { return v === "intl" || v === "cn"; }
export function resolveSite(v?: string | null): SiteId { return isSiteId(v) ? v : configuredSite; }
export function siteConfig(id?: SiteId): SiteConfig { return SITES[id ?? resolveSite()]; }
export function cdnHostFor(hostname: string): SiteId | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const id of SITE_IDS) if (SITES[id].cdnHosts.some((cdn) => host === cdn || host.endsWith(`.${cdn}`))) return id;
  return null;
}

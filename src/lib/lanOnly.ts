import net from "node:net";

/**
 * 只允许把请求发往局域网地址。
 *
 * 打印机地址与 Home Assistant 地址都由用户填写，服务端会主动去请求它们；
 * 如果放开任意主机，任何人都能让这台服务器去访问内网其它设备或云元数据端点
 * （典型 SSRF）。自用时感觉不到，一旦部署到公网就是真实攻击面。
 *
 * 允许：回环、私有 IPv4 段、`.local` 名、不带点的单标签主机名（如 u1、printer）。
 * 需要连公网目标时用 U1_ALLOW_PUBLIC_TARGETS=1 显式放开，并在文档里说明风险。
 */

const ALLOW_PUBLIC = () => process.env.U1_ALLOW_PUBLIC_TARGETS === "1";

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function hostname(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

export type LanCheck = { ok: true } | { ok: false; reason: string };

export function checkLanTarget(raw: string): LanCheck {
  const host = hostname(raw);
  if (!host) return { ok: false, reason: "empty address" };
  if (ALLOW_PUBLIC()) return { ok: true };

  const family = net.isIP(host);
  if (family === 4) {
    return isPrivateV4(host)
      ? { ok: true }
      : { ok: false, reason: `${host} 不是局域网地址（只允许 10/8、172.16/12、192.168/16、127/8、169.254/16）` };
  }
  if (family === 6) {
    const loopback = host === "::1" || host === "0:0:0:0:0:0:0:1";
    const ula = /^(fc|fd)/.test(host) === true;
    const linkLocal = /^fe80:/.test(host);
    return loopback || ula || linkLocal
      ? { ok: true }
      : { ok: false, reason: `${host} 是公网 IPv6 地址，只允许回环、ULA(fc00::/7) 或链路本地(fe80::/10)` };
  }
  if (host === "localhost" || host.endsWith(".local") || !host.includes(".")) return { ok: true };

  return {
    ok: false,
    reason: `${host} 是公网域名。这个应用只连局域网设备；确实需要时设置环境变量 U1_ALLOW_PUBLIC_TARGETS=1（会放弃这层防护）`,
  };
}

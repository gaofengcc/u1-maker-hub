/**
 * 单用户会话：HMAC 签名的 Cookie，无服务端存储。
 * 只依赖 Web Crypto，middleware（Edge Runtime）与 Node 路由都能用。
 *
 * token 格式：`v2.<过期秒>.<密码版本pwv>.<HMAC-SHA256>`
 * - pwv 让"改密码"能踢掉所有旧会话（middleware 拿当前 pwv 比对）；
 * - 签名覆盖前三段，客户端改不了过期时间与 pwv。
 */

export const SESSION_COOKIE = "u1_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 天

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

/** 常量时间比较，避免用长度差异或提前返回泄露信息。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 生成 `v2.<过期秒>.<pwv>.<签名>` 形式的会话值。 */
export async function signSession(secret: string, expiresAtSeconds: number, pwv: string): Promise<string> {
  const payload = `v2.${expiresAtSeconds}.${pwv}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

/** 会话校验结果：签名+过期是否有效，以及 token 里带的密码版本。 */
export type SessionState = { valid: boolean; pwv: string | null };

export async function readSession(secret: string, value: string | undefined | null): Promise<SessionState> {
  if (!value) return { valid: false, pwv: null };
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return { valid: false, pwv: null };
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return { valid: false, pwv: null };
  const expected = await hmacHex(secret, `${parts[0]}.${parts[1]}.${parts[2]}`);
  if (!safeEqual(expected, parts[3])) return { valid: false, pwv: null };
  return { valid: true, pwv: parts[2] };
}

/** 兼容旧调用：只关心签名与过期。 */
export async function verifySession(secret: string, value: string | undefined | null): Promise<boolean> {
  return (await readSession(secret, value)).valid;
}

/** 鉴权是否启用：配了密码才启用，方便本地开发时直接跑。 */
export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function authSecret(): string {
  // 没单独配密钥时，用初始密码派生；改密码只轮换 pwv，密钥保持稳定。
  return process.env.APP_SECRET || `derived:${process.env.APP_PASSWORD ?? ""}`;
}

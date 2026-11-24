/**
 * 单用户会话：HMAC 签名的 Cookie，无服务端存储。
 * 只依赖 Web Crypto，middleware（Edge Runtime）与 Node 路由都能用。
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

/** 生成 `v1.<过期秒>.<签名>` 形式的会话值。 */
export async function signSession(secret: string, expiresAtSeconds: number): Promise<string> {
  const payload = `v1.${expiresAtSeconds}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

/** 校验会话值：签名正确且未过期。 */
export async function verifySession(secret: string, value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return false;
  const expected = await hmacHex(secret, `${parts[0]}.${parts[1]}`);
  return safeEqual(expected, parts[2]);
}

/** 鉴权是否启用：配了密码才启用，方便本地开发时直接跑。 */
export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function authSecret(): string {
  // 没单独配密钥时，用密码派生，避免额外配置项。
  return process.env.APP_SECRET || `derived:${process.env.APP_PASSWORD ?? ""}`;
}

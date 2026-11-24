/**
 * 访问密码的持久化存储（仅 Node Runtime 使用，middleware 不要 import 本文件）。
 *
 * 设计：
 * - 优先读 ./data/auth.json（scrypt + 随机盐，权限 600），支持在网页里改密码；
 * - 没有 auth.json 时回落到环境变量 APP_PASSWORD（初始密码，systemd EnvironmentFile 注入）；
 * - `pwv` 是密码版本号（哈希前 4 字节），写进会话 token，改密码即让所有旧会话失效。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeEqual } from "./session";

export const AUTH_DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const AUTH_FILE = path.join(AUTH_DATA_DIR, "auth.json");

/** 网页端改密码的最短长度，够用且手机上不用来回切键盘。 */
export const MIN_PASSWORD_LENGTH = 6;

type AuthRecord = {
  v: 1;
  algo: "scrypt";
  salt: string;
  hash: string;
  pwv: string;
  updatedAt: string;
};

function readRecord(): AuthRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as Partial<AuthRecord>;
    if (!raw || typeof raw.hash !== "string" || typeof raw.salt !== "string") return null;
    if (raw.hash.length === 0 || raw.salt.length === 0) return null;
    return {
      v: 1,
      algo: "scrypt",
      salt: raw.salt,
      hash: raw.hash,
      pwv: typeof raw.pwv === "string" && raw.pwv ? raw.pwv : raw.hash.slice(0, 8),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function scryptHash(password: string, salt: Buffer): Buffer {
  // 默认参数 N=16384, r=8, p=1，单次 ~50ms，手机上登录感觉不到延迟。
  return crypto.scryptSync(password, salt, 64);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** 是否已设置访问密码（网页改过 或 环境变量给过初始密码）。 */
export function passwordConfigured(): boolean {
  return readRecord() !== null || Boolean(process.env.APP_PASSWORD);
}

/** 密码是否来自网页修改（true = 存在 data/auth.json）。 */
export function passwordFromFile(): boolean {
  return readRecord() !== null;
}

/** 当前密码版本号：改密码后变化，旧会话据此失效。 */
export function passwordVersion(): string {
  const record = readRecord();
  if (record) return record.pwv;
  const initial = process.env.APP_PASSWORD ?? "";
  if (!initial) return "none";
  return sha256(`env:${initial}`).slice(0, 8);
}

/** 校验密码：优先 scrypt 比对，没改过密码时比对环境变量里的初始密码。 */
export function verifyPassword(input: string): boolean {
  const record = readRecord();
  if (record) {
    const expected = Buffer.from(record.hash, "hex");
    const actual = scryptHash(input, Buffer.from(record.salt, "hex"));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  const initial = process.env.APP_PASSWORD ?? "";
  if (!initial) return false;
  return safeEqual(input, initial);
}

/** 写入新密码（覆盖 data/auth.json，权限 600）。 */
export function setPassword(password: string): void {
  const salt = crypto.randomBytes(16);
  const hash = scryptHash(password, salt);
  const record: AuthRecord = {
    v: 1,
    algo: "scrypt",
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
    pwv: hash.subarray(0, 4).toString("hex"),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(AUTH_DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(AUTH_FILE, 0o600);
}

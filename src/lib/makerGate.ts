/**
 * MakerWorld 请求闸门：给下载加最小间隔，撞到风控后熔断一段时间。
 *
 * 为什么需要：2026-11 实测 20 分钟内连续下载 50 个模型（每个 20~35 MB）后，
 * 接口开始返回 HTTP 418 + geetest 验证码，冷却两小时才恢复。开源之后如果默认
 * 不限速，所有用户都会很快撞上同一堵墙，最后表现为“这个工具废了”。
 *
 * 默认值（可用环境变量改）：
 *   MW_MIN_INTERVAL_MS      两次下载之间的最小间隔，默认 4000ms
 *   MW_CAPTCHA_COOLDOWN_MS  撞到验证码后的冷却时长，默认 30 分钟
 */

const MIN_INTERVAL_MS = Number(process.env.MW_MIN_INTERVAL_MS ?? 4000);
const CAPTCHA_COOLDOWN_MS = Number(process.env.MW_CAPTCHA_COOLDOWN_MS ?? 30 * 60 * 1000);

let lastDownloadAt = 0;
let cooldownUntil = 0;
let chain: Promise<unknown> = Promise.resolve();

export class DownloadGateError extends Error {
  code = "captcha_cooldown" as const;
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(
      `MakerWorld 刚拒绝了上一次请求并要求人机验证，为免加重风控暂停抓取 ${Math.ceil(retryAfterMs / 60000)} 分钟。` +
        `可以打开 makerworld.com 手动通过一次验证，或等冷却结束后重试。`,
    );
    this.retryAfterMs = retryAfterMs;
  }
}

export function cooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

export function gateStatus() {
  return {
    minIntervalMs: MIN_INTERVAL_MS,
    cooldownMs: cooldownRemainingMs(),
    cooldownTotalMs: CAPTCHA_COOLDOWN_MS,
  };
}

/** 记录一次风控命中：从现在起停止抓取一段时间。 */
export function noteCaptcha() {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + CAPTCHA_COOLDOWN_MS);
}

/** 下载前调用：排队串行 + 间隔限速 + 冷却期直接拒绝（不发出请求）。 */
export async function beforeDownload(): Promise<void> {
  const remaining = cooldownRemainingMs();
  if (remaining > 0) throw new DownloadGateError(remaining);

  const task = chain.then(async () => {
    const wait = lastDownloadAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDownloadAt = Date.now();
  });
  chain = task.catch(() => undefined);
  await task;
}

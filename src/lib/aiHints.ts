import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, readSettings } from "./store.ts";
import { htmlToText, type ModelHints } from "./modelHints.ts";

/**
 * 用大模型解析模型说明里的作者提示。
 *
 * 护栏（缺一不可）：
 * 1. 每个字段必须带**原文引用**，后端校验引用真的出现在说明里，否则丢弃该字段 —— 防幻觉。
 * 2. 只接受枚举/数值，不接受自由文本，也不接受任何切片参数键名 —— 防注入。
 * 3. 按说明文本哈希缓存，同一段说明只调用一次 —— 控成本与延迟。
 * 4. 任何失败（无 key / 超时 / 非 JSON / 校验不过）→ 返回 null，调用方降级到正则层。
 */

const CACHE_DIR = path.join(DATA_DIR, "aicache");
const TIMEOUT_MS = 9000;
const MAX_INPUT_CHARS = 6000;

export type HintSource = "ai" | "rule";

type AiHints = {
  supports?: "forbidden" | "required";
  layerHeight?: { min?: number; max?: number };
  infill?: { min?: number; max?: number };
  materials?: string[];
  brim?: "required" | "forbidden";
  quotes: { label: string; sentence: string }[];
  source: HintSource;
  text: string;
};

export function aiConfig(): { baseUrl: string; model: string; apiKey: string } | null {
  const saved = readSettings().ai;
  const apiKey = saved?.apiKey || process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || "";
  if (!apiKey || saved?.enabled === false) return null;
  return {
    baseUrl: (saved?.baseUrl || process.env.AI_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
    model: saved?.model || process.env.AI_MODEL || "deepseek-v4-flash",
    apiKey,
  };
}

function cachePath(plain: string): string {
  const hash = crypto.createHash("sha1").update(plain).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readCache(plain: string): AiHints | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(plain), "utf8"));
    if (raw?.hints) return { ...raw.hints, source: "ai", text: plain };
  } catch {
    /* 缓存缺失或损坏都当作未命中 */
  }
  return null;
}

function writeCache(plain: string, hints: AiHints, model: string): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(plain), JSON.stringify({ model, at: new Date().toISOString(), hints }));
  } catch {
    /* 缓存写不进去不影响主流程 */
  }
}

const SYSTEM_PROMPT = `你是 3D 打印参数解析器。从模型说明中提取**作者明确给出的打印参数建议**，只输出 JSON。

输出结构：
{"supports":"forbidden|required|null","layerHeight":{"min":数,"max":数}|null,"infill":{"min":数,"max":数}|null,"materials":["PLA"],"brim":"required|forbidden|null","quotes":[{"label":"支撑禁止|支撑必需|层高|填充|brim|材料","sentence":"原文逐字片段"}]}

规则：
- 每个非 null 字段都必须在 quotes 里配一条原文句子，sentence 必须是说明里**逐字存在**的片段，不许改写、不许翻译。
- 不确定就填 null，不要推断、不要给"通常建议"这类通用经验。
- "适用于 PLA 和 PETG 支撑"这类是在说支撑用什么材料，不是要求开支撑。
- "100% 填充只需要 11g 料"这类是在说用量，不是配置建议。
- 数值必须紧贴对应参数名：说明里的"底层高度 0.16mm""最小深度 0.48mm"不是层高。
- 只讨论说明里出现的参数；没写的参数不要猜。`;

function normalize(value: string): string {
  return value.replace(/\s+/g, "");
}

/** 校验：引用必须是原文子串，否则该字段视为幻觉丢弃。 */
function grounded(sentence: string, plain: string): boolean {
  const s = normalize(sentence);
  return s.length >= 2 && normalize(plain).includes(s);
}

function num(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return Math.round(n * 1000) / 1000;
}

function range(raw: unknown, min: number, max: number): { min: number; max: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = num((raw as Record<string, unknown>).min, min, max);
  const b = num((raw as Record<string, unknown>).max, min, max);
  if (a === undefined && b === undefined) return undefined;
  const lo = a ?? b!;
  const hi = b ?? a!;
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/** 把模型返回的 JSON 变成可信的 ModelHints：逐字段做引用校验 + 取值范围夹取。 */
export function validateAiHints(raw: unknown, plain: string): AiHints | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const quotes = Array.isArray(body.quotes)
    ? body.quotes
        .map((q) => q as { label?: unknown; sentence?: unknown })
        .filter((q) => typeof q.sentence === "string" && grounded(q.sentence as string, plain))
        .map((q) => ({ label: String(q.label ?? "作者说明"), sentence: String(q.sentence) }))
        .slice(0, 8)
    : [];

  // 只有被引用句子支撑的字段才采纳
  const cited = (label: string): boolean => quotes.some((q) => q.label.includes(label));

  const hints: AiHints = { quotes, source: "ai", text: plain };
  if ((body.supports === "forbidden" || body.supports === "required") && cited("支撑")) {
    hints.supports = body.supports;
  }
  if (cited("层高")) {
    const lh = range(body.layerHeight, 0.04, 0.6);
    if (lh) hints.layerHeight = lh;
  }
  if (cited("填充")) {
    const inf = range(body.infill, 0, 100);
    if (inf) hints.infill = inf;
  }
  if (cited("brim")) {
    if (body.brim === "required" || body.brim === "forbidden") hints.brim = body.brim;
  }
  if (cited("材料") && Array.isArray(body.materials)) {
    const known = ["PLA", "PETG", "ABS", "ASA", "TPU", "PC", "PA"];
    const mats = body.materials
      .map((m) => String(m).toUpperCase())
      .filter((m) => known.includes(m));
    if (mats.length) hints.materials = Array.from(new Set(mats));
  }
  return hints.quotes.length || hints.supports || hints.layerHeight || hints.infill ? hints : null;
}

/** 调大模型解析说明；命中缓存直接返回，任何失败返回 null（调用方降级到正则）。 */
export async function parseHintsWithAI(summaryHtml: string): Promise<AiHints | null> {
  const plain = htmlToText(summaryHtml).slice(0, MAX_INPUT_CHARS);
  if (!plain.trim()) return null;
  const cached = readCache(plain);
  if (cached) return cached;

  const config = aiConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `模型说明原文：\n${plain}` },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim());
    const hints = validateAiHints(parsed, plain);
    if (hints) writeCache(plain, hints, config.model);
    return hints;
  } catch {
    return null;
  }
}

/** 合并：AI 解析成功的字段优先，其余保留正则结果，两者都带原文引用。 */
export function mergeHints(rule: ModelHints, ai: AiHints | null): { hints: ModelHints; source: HintSource } {
  if (!ai) return { hints: { ...rule, source: "rule" }, source: "rule" };
  const quotes = [...ai.quotes];
  for (const q of rule.quotes) {
    if (!quotes.some((existing) => normalize(existing.sentence) === normalize(q.sentence))) quotes.push(q);
  }
  return {
    hints: {
      supports: ai.supports ?? rule.supports,
      layerHeight: ai.layerHeight ?? rule.layerHeight,
      infill: ai.infill ?? rule.infill,
      materials: ai.materials ?? rule.materials,
      brim: ai.brim ?? rule.brim,
      quotes,
      text: ai.text,
      source: "ai",
    },
    source: "ai",
  };
}

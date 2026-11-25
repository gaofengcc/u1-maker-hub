/** 作者在模型说明中给出的打印提示。 */
export type ModelHints = {
  supports?: "forbidden" | "required";
  layerHeight?: { min?: number; max?: number };
  infill?: { min?: number; max?: number };
  materials?: string[];
  brim?: "required" | "forbidden";
  quotes: { label: string; sentence: string }[];
  text: string;
};

/**
 * 将常见 HTML 实体解码。说明来自接口，不能假定浏览器 DOM 在解析环境中存在。
 */
function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_, raw: string) => {
      const code = raw.toLowerCase().startsWith("x")
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (_, name: string) => named[name.toLowerCase()] ?? `&${name};`);
}

/** HTML 转纯文本，同时为说明中的段落和列表保留句子边界。 */
function htmlToText(summaryHtml: string): string {
  const source = String(summaryHtml ?? "");
  const withBreaks = source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|div|h[1-6]|tr)\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  return decodeEntities(withoutTags)
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/[ ]+\n/g, "\n")
    .trim();
}

function splitSentences(text: string): string[] {
  // 英文句号仅在后面有空白时切分，避免把 0.16 这样的数值拆开。
  return text
    .split(/(?<=[。！？!?\n])|(?<=\.\s+)/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function addQuote(
  quotes: { label: string; sentence: string }[],
  label: string,
  sentence: string,
): void {
  if (!quotes.some((quote) => quote.label === label && quote.sentence === sentence)) {
    quotes.push({ label, sentence });
  }
}

function rangeFromValues(first: string, second?: string): { min: number; max: number } {
  const a = Number.parseFloat(first);
  const b = second === undefined ? a : Number.parseFloat(second);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function valuesAfterAnchor(sentence: string, anchor: RegExp, maxCharacters: number): [string, string?] | null {
  return numbersNearAnchor(sentence, anchor, { before: 20, after: maxCharacters, unit: "mm" });
}

/**
 * 只在锚点附近的**小窗口**里取数，并且要求数字带单位（mm / %），
 * 还要排除「底层高度 0.16mm」「最小深度 0.48mm」这类**邻近其他参数**的数字。
 * 真实语料教训：`以0.08mm的层高，100%的填充率进行打印，底层高度为0.16mm`
 * 上一版取到了 0.16（底层高度），把作者要的 0.08 丢了。
 */
function numbersNearAnchor(
  sentence: string,
  anchor: RegExp,
  opts: { before: number; after: number; unit: "mm" | "%" },
): [string, string?] | null {
  const match = anchor.exec(sentence);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - opts.before);
  const end = Math.min(sentence.length, match.index + match[0].length + opts.after);
  const segment = sentence.slice(start, end);
  const pattern = opts.unit === "mm"
    ? /(\d+(?:\.\d{1,2})?)\s*mm/giu
    : /(\d{1,3})\s*%/gu;
  const values: string[] = [];
  for (const hit of segment.matchAll(pattern)) {
    const at = hit.index ?? 0;
    // 数字紧前面若是另一个参数名，说明这个数不属于锚点。
    const context = segment.slice(Math.max(0, at - 6), at);
    if (/高度|深度|层数|首层|底层|挤出|温度|速度|流量|间距|壁厚/u.test(context)) continue;
    // 数字后面的名词也算：`0.48mm最小深度` 里 0.48 是深度，不是层高。
    const follow = segment.slice(at + hit[0].length, at + hit[0].length + 6);
    if (/深度|高度|层数|壁厚|间距|速度|温度|流量/u.test(follow)) continue;
    values.push(hit[1]);
    if (values.length === 2) break;
  }
  return values.length ? [values[0], values[1]] : null;
}

// 用量语境：`两组4个100%填充只需要11g料` 是在说省料，不是配置建议。
const USAGE_CONTEXT = /只需要|只需|仅需|只用|用不了|省料|省下/u;

function infillNearAnchor(sentence: string): [string, string?] | null {
  if (USAGE_CONTEXT.test(sentence)) return null;
  const anchor = /填充|infill/i;
  const match = anchor.exec(sentence);
  if (!match || match.index === undefined) return null;
  // 数字在后面的写法：`填充 10-15%` / `infill 15%`
  const tail = sentence.slice(match.index + match[0].length, match.index + match[0].length + 32);
  const range = tail.match(/(\d{1,3})\s*[-~到至]\s*(\d{1,3})\s*%/u);
  if (range) return [range[1], range[2]];
  const single = tail.match(/(\d{1,3})\s*%/u);
  if (single) return [single[1]];
  // 数字在前面的写法：`100%的填充率`
  const head = sentence.slice(Math.max(0, match.index - 16), match.index);
  const before = head.match(/(\d{1,3})\s*%/u);
  return before ? [before[1]] : null;
}

/** 从 MakerWorld 的说明 HTML 中提取作者对打印参数的明确建议。 */
export function extractHints(summaryHtml: string): ModelHints {
  const text = htmlToText(summaryHtml);
  const quotes: { label: string; sentence: string }[] = [];
  let supportsForbidden = false;
  let supportsRequired = false;
  let layerHeight: { min?: number; max?: number } | undefined;
  let infill: { min?: number; max?: number } | undefined;
  let brim: "required" | "forbidden" | undefined;
  const materials: string[] = [];

  for (const sentence of splitSentences(text)) {
    const forbiddenSupport =
      /(?:禁止|不要|不需|无需|不开|关闭|留空|🚫)[\s\S]{0,8}支撑|支撑[\s\S]{0,8}(?:禁止|不要|不需|无需|不开|关闭|留空|🚫)/u.test(sentence) ||
      /支撑\s*[:：][^。！？!?\n]{0,40}(?:禁止|🚫|无|none)/iu.test(sentence) ||
      /\bno\s+supports?\b|\bwithout\s+supports?\b|\bsupports?\s*[:：]\s*(?:none|no|off)\b/i.test(sentence);
    const requiredSupport =
      /(?:需要|务必|必须|建议开)[\s\S]{0,8}支撑/u.test(sentence) ||
      /\badd\s+supports?\b/i.test(sentence) ||
      (/\bsupports?\s+(?:(?:are|is)\s+)?(?:required|needed)\b/i.test(sentence) &&
        !/\b(?:no|without)\s+supports?\s+(?:(?:are|is)\s+)?(?:required|needed)\b/i.test(sentence)) ||
      // 列举式指令：`使用宽裙边（例如8毫米），以及细树状支撑`
      // 真实语料里作者常把支撑当成"要素"列出来，不带"需要/必须"。
      (/(?:以及|还有|配上|配合|使用|加上|同时开)[^。！？!?\n]{0,12}支撑/u.test(sentence) &&
        // 但"适用于 PLA 和 PETG 支撑"是在说支撑用什么料，不是要开支撑。
        !/(?:适用于|适用|材料|耗材|线材|支撑材料)[^。！？!?\n]{0,10}支撑/u.test(sentence) &&
        !/支撑[^。！？!?\n]{0,8}(?:材料|耗材|线材)/u.test(sentence));
    if (forbiddenSupport) {
      supportsForbidden = true;
      addQuote(quotes, "支撑禁止", sentence);
    }
    if (requiredSupport) {
      supportsRequired = true;
      addQuote(quotes, "支撑必需", sentence);
    }

    // 说明通常在数值间带有 mm、空格和“或”等连接词，给连接文本留出余量后仍只取前两个数。
    const layerValues = valuesAfterAnchor(sentence, /层高|layer\s+height/i, 32);
    if (layerValues && layerHeight === undefined) {
      // 先出现的明确层高优先：后文常有「低于 X mm 时可用更高层高」这类补充说明。
      layerHeight = rangeFromValues(layerValues[0], layerValues[1]);
      addQuote(quotes, "层高", sentence);
    }

    const infillValues = infillNearAnchor(sentence);
    if (infillValues) {
      infill = rangeFromValues(infillValues[0], infillValues[1]);
      addQuote(quotes, "填充", sentence);
    }

    const sentenceMaterials = sentence.match(/\b(?:PLA|PETG|ABS|ASA|TPU)\b/g);
    if (sentenceMaterials) {
      for (const material of sentenceMaterials) {
        if (!materials.includes(material)) materials.push(material);
      }
      addQuote(quotes, "材料", sentence);
    }

    if (/(?:需要|务必|必须).{0,6}(?:brim|裙边)|(?:brim|裙边).*(?:必须|建议)/iu.test(sentence) ||
        // `使用宽裙边（例如8毫米）` 也算要求
        /(?:使用|加|开|用)[^。！？!?\n]{0,6}(?:宽)?(?:裙边|brim)/iu.test(sentence)) {
      brim = "required";
      addQuote(quotes, "brim 必需", sentence);
    } else if (/(?:不要|无需)\s+(?:使用\s+)?brim/i.test(sentence)) {
      brim = "forbidden";
      addQuote(quotes, "brim 禁止", sentence);
    }
  }

  return {
    ...(supportsForbidden || supportsRequired ? { supports: supportsForbidden ? "forbidden" : "required" } : {}),
    ...(layerHeight ? { layerHeight } : {}),
    ...(infill ? { infill } : {}),
    ...(materials.length ? { materials } : {}),
    ...(brim ? { brim } : {}),
    quotes,
    text,
  };
}

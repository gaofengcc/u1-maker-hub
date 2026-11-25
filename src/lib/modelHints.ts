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
  const match = anchor.exec(sentence);
  if (!match || match.index === undefined) return null;
  const tail = sentence.slice(match.index + match[0].length, match.index + match[0].length + maxCharacters);
  const values = [...tail.matchAll(/\d+\.\d{1,2}/gu)].slice(0, 2).map((match) => match[0]);
  return values.length ? [values[0], values[1]] : null;
}

function infillAfterAnchor(sentence: string): [string, string?] | null {
  const anchor = /填充|infill/i;
  const match = anchor.exec(sentence);
  if (!match || match.index === undefined) return null;
  const tail = sentence.slice(match.index + match[0].length, match.index + match[0].length + 32);
  const range = tail.match(/(\d{1,3})\s*[-~到至]\s*(\d{1,3})\s*%/u);
  if (range) return [range[1], range[2]];
  const single = tail.match(/(\d{1,3})\s*%/u);
  return single ? [single[1]] : null;
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
      (/\bsupports?\s+(?:(?:are|is)\s+)?(?:required|needed)\b|\badd\s+supports?\b/i.test(sentence) &&
        !/\b(?:no|without)\s+supports?\b/i.test(sentence));
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
    if (layerValues) {
      layerHeight = rangeFromValues(layerValues[0], layerValues[1]);
      addQuote(quotes, "层高", sentence);
    }

    const infillValues = infillAfterAnchor(sentence);
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

    if (/(?:需要|务必|必须).{0,6}brim|brim.*(?:必须|建议)/i.test(sentence)) {
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

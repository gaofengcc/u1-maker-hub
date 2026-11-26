import base from "@/messages/zh-CN";
import monitor from "@/messages/zh-CN.monitor";
import misc from "@/messages/zh-CN.misc";
import history from "@/messages/zh-CN.history";

type Vars = Record<string, string | number>;
type Dict = { [key: string]: string | readonly string[] | Dict };

/**
 * 深合并多个词典片段。后者的同名键覆盖前者，嵌套对象递归合并。
 * 拆成多个文件是为了让多个页面可以并行翻译而不互相覆盖同一个词典文件。
 */
function mergeDict(...parts: Dict[]): Dict {
  const out: Dict = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part ?? {})) {
      const prev = out[key];
      if (value && typeof value === "object" && !Array.isArray(value) && prev && typeof prev === "object" && !Array.isArray(prev)) {
        out[key] = mergeDict(prev as Dict, value as Dict);
      } else {
        out[key] = value as string | readonly string[] | Dict;
      }
    }
  }
  return out;
}

const zhCN: Dict = mergeDict(base as Dict, monitor as Dict, misc as Dict, history as Dict);

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object" && part in value) return (value as Record<string, unknown>)[part];
    return undefined;
  }, zhCN);
}

/** Minimal, dependency-free translation helper. The first phase has only zh-CN. */
export function t(key: string, vars?: Vars): string {
  const value = lookup(key);
  const text = typeof value === "string" ? value : key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : text;
}

export function tList(key: string): readonly string[] {
  const value = lookup(key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

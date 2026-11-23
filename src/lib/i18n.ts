import zhCN from "@/messages/zh-CN";

type Vars = Record<string, string | number>;

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

import { readSettings } from "./store.ts";

/**
 * The printer's smart plug, switched through Home Assistant's REST API with a long-lived token.
 * The plug is set as an entity id (switch.u1_plug) or as a device id, whose first switch entity is used.
 */

export class PowerError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const ENTITY = /^(switch|light|input_boolean)\.[a-z0-9_]+$/;
const DEVICE = /^[a-f0-9]{32}$/;

export function isPlugRef(v: string) {
  return ENTITY.test(v) || DEVICE.test(v);
}

function config() {
  const s = readSettings();
  const url = (s.haUrl?.trim() ?? "").replace(/\/+$/, "");
  const plug = s.haPlug?.trim() ?? "";
  if (!url) throw new PowerError("No Home Assistant address set. Add it in Settings.", 400);
  if (!plug) throw new PowerError("No Home Assistant plug set. Add it in Settings.", 400);
  if (!s.haToken) throw new PowerError("No Home Assistant token set. Add it in Settings.", 400);
  return { url, plug, token: s.haToken };
}

export function powerConfigured() {
  const s = readSettings();
  return Boolean(s.haToken && s.haUrl?.trim() && s.haPlug?.trim());
}

async function ha<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = config();
  let res: Response;
  try {
    res = await fetch(`${url}${pathname}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new PowerError(`Home Assistant at ${url} ${reason}.`);
  }
  if (res.status === 401) throw new PowerError("Home Assistant refused the token (401). Create a new long-lived token.", 401);
  if (!res.ok) throw new PowerError(`Home Assistant answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Entity ids found per device id; a device's entities rarely change, so this lives until restart. */
const resolved = new Map<string, string>();

async function plugEntity(): Promise<string> {
  const { plug, url } = config();
  if (ENTITY.test(plug)) return plug;
  if (!DEVICE.test(plug)) throw new PowerError(`"${plug}" is neither an entity id nor a device id.`, 400);
  const key = `${url}|${plug}`;
  const cached = resolved.get(key);
  if (cached) return cached;
  const template = `{{ device_entities('${plug}') | select('match', '^switch\\.') | list | first | default('') }}`;
  const entity = String(await ha<string>("/api/template", { method: "POST", body: JSON.stringify({ template }) })).trim();
  if (!ENTITY.test(entity)) throw new PowerError(`The Home Assistant device ${plug} has no switch entity. Set the plug's entity id in Settings.`, 404);
  resolved.set(key, entity);
  return entity;
}

export type PowerState = { entity: string; name: string; state: "on" | "off" | "unavailable" | string };

export async function getPower(): Promise<PowerState> {
  const entity = await plugEntity();
  const s = await ha<{ state: string; attributes?: { friendly_name?: string } }>(`/api/states/${entity}`);
  return { entity, name: s.attributes?.friendly_name ?? entity, state: s.state };
}

export async function setPower(on: boolean): Promise<void> {
  const entity = await plugEntity();
  const domain = entity.split(".")[0];
  await ha(`/api/services/${domain}/${on ? "turn_on" : "turn_off"}`, { method: "POST", body: JSON.stringify({ entity_id: entity }) });
}

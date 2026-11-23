import { NextResponse } from "next/server";
import { MakerWorldError } from "./makerworld.ts";
import { PrinterError } from "./printer.ts";
import { PowerError } from "./homeassistant.ts";

/** Turns any thrown error into a JSON response the UI can show. */
export function errorResponse(err: unknown) {
  if (err instanceof MakerWorldError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status >= 400 ? err.status : 502 });
  }
  if (err instanceof PrinterError) {
    return NextResponse.json({ error: err.message, code: "printer" }, { status: err.status >= 400 ? err.status : 502 });
  }
  if (err instanceof PowerError) {
    return NextResponse.json({ error: err.message, code: "power" }, { status: err.status >= 400 ? err.status : 502 });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

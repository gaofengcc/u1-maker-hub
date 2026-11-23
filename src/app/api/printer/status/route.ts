import { connection, NextResponse } from "next/server";
import { getStatus, jobHistory, PrinterError } from "@/lib/printer.ts";
import { readSettings } from "@/lib/store.ts";

export async function GET(req: Request) {
  await connection();
  if (!readSettings().printerHost) return NextResponse.json({ online: false, configured: false, error: "No printer address set." });
  const withHistory = new URL(req.url).searchParams.get("history") === "1";
  try {
    const status = await getStatus();
    const history = withHistory ? await jobHistory(8).catch(() => []) : undefined;
    return NextResponse.json({ ...status, configured: true, history });
  } catch (err) {
    const message = err instanceof PrinterError || err instanceof Error ? err.message : String(err);
    return NextResponse.json({ online: false, configured: true, error: message });
  }
}

import { connection, NextResponse } from "next/server";
import { exportHistoryCsv } from "@/lib/history.ts";
export async function GET() {
  await connection();
  return new NextResponse(exportHistoryCsv(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=history.csv" } });
}

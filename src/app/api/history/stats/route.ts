import { connection, NextResponse } from "next/server";
import { historyStats } from "@/lib/history.ts";
export async function GET() {
  await connection();
  return NextResponse.json(historyStats());
}

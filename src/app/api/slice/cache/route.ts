import { NextResponse } from "next/server";
import { sliceCacheStats } from "@/lib/sliceTasks.ts";

export async function GET() {
  return NextResponse.json(sliceCacheStats());
}

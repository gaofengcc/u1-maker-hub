import { connection, NextResponse } from "next/server";
import { addManyToPlate, addToPlate, clearPlate, listPlate, type PlateEntry } from "@/lib/plate.ts";
import { readJson } from "@/lib/http.ts";
import { getUpload } from "@/lib/uploads.ts";

type NewEntry = Omit<PlateEntry, "id" | "addedAt">;

export async function GET() {
  await connection();
  return NextResponse.json(listPlate());
}

// A MakerWorld profile, or an upload that exists (sent by hand or by the designer app).
const valid = (b: NewEntry) =>
  Boolean(b?.title) && (b.uploadId ? getUpload(String(b.uploadId)) !== null : Number.isInteger(b?.designId) && Number.isInteger(b?.instanceId));

/** Adds a model (one profile and plate of it, or an upload) to the plate, or a list of them at once. */
export async function POST(req: Request) {
  const b = await readJson<NewEntry | NewEntry[]>(req);
  if (Array.isArray(b)) {
    if (!b.length || b.length > 50 || !b.every(valid)) return NextResponse.json({ error: "Invalid models." }, { status: 400 });
    return NextResponse.json(addManyToPlate(b));
  }
  if (!valid(b)) return NextResponse.json({ error: "Invalid model." }, { status: 400 });
  return NextResponse.json(addToPlate(b));
}

export async function DELETE() {
  return NextResponse.json(clearPlate());
}

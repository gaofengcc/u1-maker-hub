import { NextResponse, type NextRequest } from "next/server";
import { kindFromName, listUploads, MAX_UPLOAD_BYTES, saveUpload } from "@/lib/uploads.ts";

export async function GET() {
  return NextResponse.json(listUploads());
}

/**
 * Body: the raw STL or 3MF bytes. Query `name`: the original file name; `origin`: the app sending it
 * (for example "designer"), when it is not a hand upload. Responds with the upload and its check report.
 */
export async function POST(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "model.stl";
  const origin = /^[a-z][a-z0-9-]{0,19}$/.test(req.nextUrl.searchParams.get("origin") ?? "") ? req.nextUrl.searchParams.get("origin")! : undefined;
  if (!kindFromName(name)) return NextResponse.json({ error: "Only STL and 3MF files can be uploaded." }, { status: 400 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }
  try {
    const data = Buffer.from(await req.arrayBuffer());
    return NextResponse.json(await saveUpload(name, data, origin), { status: 201 });
  } catch (err) {
    // Parse errors are about the file, not the server.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

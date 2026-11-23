import { connection, NextResponse } from "next/server";
import { cameraUrls, PrinterError, wakeCamera } from "@/lib/printer.ts";

/**
 * Returns the latest U1 camera frame (JPEG). The stock camera rewrites its image about 3.5 times
 * a second, so the browser polls this about 4 times a second.
 */
export async function GET() {
  await connection();
  try {
    // Keep the camera awake while someone is watching (throttled inside wakeCamera).
    const wake = wakeCamera();
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const url of cameraUrls()) {
        const frame = await fetchFrame(url);
        if (frame) {
          return new Response(new Uint8Array(frame), {
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
          });
        }
      }
      if (attempt === 0) {
        // A torn read (the camera was rewriting the file) clears up within a few milliseconds.
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      // Still nothing: the camera was asleep. Wake it, then retry once.
      await wakeCamera(true);
      await wake;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return NextResponse.json({ error: "The camera did not answer." }, { status: 503 });
  } catch (err) {
    const message = err instanceof PrinterError || err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Downloads one image and returns it only if it is a complete JPEG (starts FF D8, ends FF D9). */
async function fetchFrame(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const complete = buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf.at(-2) === 0xff && buf.at(-1) === 0xd9;
    return complete ? buf : null;
  } catch {
    return null;
  }
}

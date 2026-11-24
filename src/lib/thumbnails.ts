import fs from "node:fs";
import { thumbnailPng } from "./png.ts";

/**
 * The U1 shows a picture of the print in its file list and in the Snapmaker app. Moonraker builds
 * that picture (`gcodes/.thumbs/…`) only from the `; thumbnail begin` comments in the G-code, and
 * OrcaSlicer's command line leaves them out here (it renders them with the plate view, which needs a
 * display). So the hub writes the blocks itself, from the plate picture of the source 3MF.
 */

/** What the U1 app asks for, smallest first like OrcaSlicer writes them. The 300 one is also the source of the 96 × 96. */
const SIZES = [48, 300];

/** Returns false when there is no usable picture, or the G-code already carries thumbnails. */
export function addGcodeThumbnails(gcode: string, picture: Buffer | null): boolean {
  if (!picture) return false;
  const blocks: string[] = [];
  for (const size of SIZES) {
    const png = thumbnailPng(picture, size);
    if (png) blocks.push(thumbnailBlock(png, size));
  }
  if (!blocks.length) return false;
  const text = fs.readFileSync(gcode, "utf8");
  if (text.includes("; thumbnail begin")) return false;
  const body = blocks.join("\n");
  const after = "; HEADER_BLOCK_END";
  const at = text.indexOf(after);
  fs.writeFileSync(gcode, at >= 0 ? text.slice(0, at + after.length) + `\n\n${body}` + text.slice(at + after.length) : `${body}\n${text}`);
  return true;
}

/**
 * One block in the shape OrcaSlicer writes and Moonraker reads: `; thumbnail begin WxH <base64 length>`,
 * then the picture as base64, one `;`-prefixed line per 78 characters, then `; thumbnail end`.
 * Moonraker compares the number on the begin line with the length of the base64 text, not the picture.
 */
function thumbnailBlock(png: Buffer, size: number) {
  const base64 = png.toString("base64");
  const rows = base64.match(/.{1,78}/g) ?? [];
  return `; THUMBNAIL_BLOCK_START\n\n;\n; thumbnail begin ${size}x${size} ${base64.length}\n${rows.map((row) => `; ${row}\n`).join("")}; thumbnail end\n;\n; THUMBNAIL_BLOCK_END\n`;
}

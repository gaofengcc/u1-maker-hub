import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { attr, formatMat, itemsOnPlate, loadProject, mul, plateMesh, remapPaint, type Mat, type PlateTransform, type Project } from "./geometry.ts";
import { footprint, packBeds } from "./packing.ts";
import { orientedBox, orientMat } from "./orient.ts";

/**
 * Builds Bambu-style 3MF projects holding several models, one project per U1 plate.
 *
 * Each model keeps its meshes, parts and colour painting. Its filaments are renumbered so that
 * filament N of the combined project is U1 toolhead N (T1..T4), using the colour mapping chosen for
 * that model, and its copies are placed with the same packing the preview shows. What does not fit
 * on one plate goes on the next one.
 */

export type CombineSource = {
  file: string;
  plate: number;
  transform: PlateTransform;
  copies: number;
  /** U1 plate this model is pinned to (1-based); missing or 0 = placed automatically. */
  bed?: number;
  /** For each filament of the source (0-based), the U1 toolhead index (0..3). */
  filamentToTool: number[];
  title: string;
};

const MODEL = "3D/3dmodel.model";
const MODEL_RELS = "3D/_rels/3dmodel.model.rels";
const MODEL_SETTINGS = "Metadata/model_settings.config";

const uuid = () => crypto.randomUUID();

export class PlateFitError extends Error {}

/** Writes plate-1.3mf, plate-2.3mf… in `dir`, one per U1 plate, and returns their paths in order. */
export async function combineProjects(sources: CombineSource[], dir: string) {
  if (!sources.length) throw new Error("The plate is empty.");
  const projects: Project[] = [];
  for (const s of sources) projects.push(await loadProject(s.file));

  // Same footprints, in the same order, as the browser preview: the box after each model's orientation.
  const groups = sources.map((s, k) => {
    const mesh = plateMesh(projects[k], s.plate);
    const bbox = orientedBox(mesh.positions, s.transform.orient, mesh.bbox);
    return { bbox, size: footprint(bbox, s.transform.scale, s.transform.rotation) };
  });
  const copies = sources.flatMap((s, k) => Array.from({ length: Math.max(1, s.copies) }, () => k));
  const places = packBeds(copies.map((k) => ({ w: groups[k].size[0], d: groups[k].size[1], bed: sources[k].bed })));
  const missing = [...new Set(copies.filter((_, c) => !places[c]).map((k) => sources[k].title))];
  if (missing.length) throw new PlateFitError(`Too big for the U1 bed: ${missing.join(", ")}. Make these models smaller or rotate them.`);

  const beds = Math.max(...places.map((p) => p!.bed));
  const files: string[] = [];
  fs.mkdirSync(dir, { recursive: true });
  for (let bed = 1; bed <= beds; bed++) {
    const file = path.join(dir, `plate-${bed}.3mf`);
    await writeBed(sources, projects, groups, copies.map((k, c) => (places[c]!.bed === bed ? { source: k, x: places[c]!.x, y: places[c]!.y } : null)), file);
    files.push(file);
  }
  return { files, copies: copies.length };
}

type Copy = { source: number; x: number; y: number } | null;

/** One single-plate project with the copies placed on it (null entries are on other plates). */
async function writeBed(sources: CombineSource[], projects: Project[], groups: { bbox: number[] }[], copies: Copy[], dst: string) {
  const out = await JSZip.loadAsync(fs.readFileSync(sources[0].file));
  out.forEach((name) => {
    if (/^3D\/Objects\//.test(name) || /^Metadata\/(plate_|top_|pick_|cut_information|filament_sequence)/.test(name)) out.remove(name);
  });

  const objects: string[] = [];
  const settings: string[] = [];
  const items: string[] = [];
  const instances: string[] = [];
  const meshFiles: string[] = [];
  let nextId = 1;
  let identify = 1000;
  // Sub-objects (and the parts named after them) must be numbered uniquely across all mesh files.
  let subOffset = 0;

  for (const [k, s] of sources.entries()) {
    if (!copies.some((c) => c?.source === k)) continue;
    const p = projects[k];
    const toFilament = (state: number) => (state > 0 ? (s.filamentToTool[state - 1] ?? 0) + 1 : 0);
    const picked = itemsOnPlate(p, s.plate);

    // Mesh files the picked objects use, copied with their paint renumbered.
    const pathMap = new Map<string, string>();
    const topIds = [...new Set(picked.map((i) => p.items[i].objectId))];
    const localIds = new Set<string>(topIds);
    for (const id of topIds) {
      for (const c of p.objects.get(`#${id}`)?.components ?? []) {
        if (c.path) pathMap.set(c.path, `/3D/Objects/m${k + 1}_${c.path.split("/").pop()}`);
        else localIds.add(c.objectId);
      }
    }
    const offset = subOffset;
    const shift = (id: string) => String(Number(id) + offset);
    let maxSub = 0;
    for (const [from, to] of pathMap) {
      const xml = (await p.zip.file(from.replace(/^\//, ""))?.async("string")) ?? "";
      const renumbered = xml
        .replace(/(<object\b[^>]*?\sid=")(\d+)"/g, (_, head: string, id: string) => {
          maxSub = Math.max(maxSub, Number(id));
          return `${head}${shift(id)}"`;
        })
        .replace(/(<component\b[^>]*?\sobjectid=")(\d+)"/g, (_, head: string, id: string) => `${head}${shift(id)}"`);
      out.file(to.slice(1), renumberPaint(renumbered, toFilament));
      meshFiles.push(to);
    }
    subOffset += maxSub;

    // Objects of the main model, with new ids.
    const idMap = new Map<string, string>([...localIds].map((id) => [id, String(nextId++)]));
    for (const id of localIds) {
      const xml = new RegExp(`<object\\b[^>]*\\sid="${id}"[^>]*>[\\s\\S]*?</object>`).exec(p.modelXml)?.[0];
      if (!xml) continue;
      let next = xml.replace(/^<object\b[^>]*>/, (open) => open.replace(/\sid="[^"]*"/, ` id="${idMap.get(id)}"`));
      next = next.replace(/<component\b[^>]*?\/?>/g, (tag) => {
        const path = attr(tag, "p:path");
        if (path) return tag.replace(/\sp:path="[^"]*"/, ` p:path="${pathMap.get(path)}"`).replace(/\sobjectid="(\d+)"/, (_, n: string) => ` objectid="${shift(n)}"`);
        const local = attr(tag, "objectid");
        return local && idMap.has(local) ? tag.replace(/\sobjectid="[^"]*"/, ` objectid="${idMap.get(local)}"`) : tag;
      });
      objects.push(renumberPaint(next, toFilament));
    }

    // Per-object settings: filaments renumbered, parts named after their renumbered sub-objects.
    for (const id of topIds) {
      const block = new RegExp(`<object id="${id}">[\\s\\S]*?</object>`).exec(p.config)?.[0];
      const parts = block?.replace(/<part id="(\d+)"/g, (_, n: string) => `<part id="${shift(n)}"`);
      settings.push(objectSettings(parts, idMap.get(id)!, toFilament, s.title));
    }

    // One build item per picked item and copy, oriented, then moved to its packed place.
    const [minX, minY, minZ, maxX, maxY] = groups[k].bbox;
    const orient = orientMat(s.transform.orient);
    const a = (-s.transform.rotation * Math.PI) / 180;
    const sc = s.transform.scale;
    const toOrigin: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, -(minX + maxX) / 2, -(minY + maxY) / 2, -minZ];
    const scaleRotate: Mat = [Math.cos(a) * sc, Math.sin(a) * sc, 0, -Math.sin(a) * sc, Math.cos(a) * sc, 0, 0, 0, sc, 0, 0, 0];
    const instanceCount = new Map<string, number>();
    for (const place of copies) {
      if (place?.source !== k) continue;
      const g = mul(mul(mul(orient, toOrigin), scaleRotate), [1, 0, 0, 0, 1, 0, 0, 0, 1, place.x, place.y, 0]);
      for (const i of picked) {
        const item = p.items[i];
        const objectId = idMap.get(item.objectId)!;
        const n = instanceCount.get(objectId) ?? 0;
        instanceCount.set(objectId, n + 1);
        items.push(`  <item objectid="${objectId}" p:UUID="${uuid()}" transform="${formatMat(mul(item.transform, g))}" printable="1" />`);
        instances.push(
          `    <model_instance>\n      <metadata key="object_id" value="${objectId}"/>\n      <metadata key="instance_id" value="${n}"/>\n      <metadata key="identify_id" value="${identify++}"/>\n    </model_instance>`,
        );
      }
    }
  }

  // Keep the first project's header (it tells OrcaSlicer this is a Bambu-style project).
  const first = projects[0].modelXml;
  const header = first.slice(0, first.indexOf("<resources")).replace(/<metadata name="(Title|Description|Designer|DesignerUserId|DesignerCover)">[\s\S]*?<\/metadata>\s*/g, "");
  out.file(MODEL, `${header}<resources>\n${objects.join("\n")}\n </resources>\n <build p:UUID="${uuid()}">\n${items.join("\n")}\n </build>\n</model>\n`);
  out.file(
    MODEL_RELS,
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${meshFiles
      .map((f, i) => ` <Relationship Target="${f}" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`)
      .join("\n")}\n</Relationships>\n`,
  );
  out.file(
    MODEL_SETTINGS,
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${settings.join("\n")}\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n${instances.join("\n")}\n  </plate>\n</config>\n`,
  );
  fs.writeFileSync(dst, await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function renumberPaint(xml: string, toFilament: (state: number) => number) {
  return xml.replace(/\spaint_color="([0-9A-Fa-f]+)"/g, (_, code: string) => ` paint_color="${remapPaint(code, toFilament)}"`);
}

/** The model_settings.config block of one object, with its id and filaments rewritten. */
function objectSettings(block: string | undefined, id: string, toFilament: (state: number) => number, title: string) {
  if (!block) {
    const name = title.replace(/[<>&"]/g, "");
    return `  <object id="${id}">\n    <metadata key="name" value="${name}"/>\n    <metadata key="extruder" value="${toFilament(1)}"/>\n  </object>`;
  }
  let next = block.replace(/^<object id="\d+">/, `<object id="${id}">`);
  next = next.replace(/key="extruder" value="(\d+)"/g, (_, n: string) => `key="extruder" value="${toFilament(Number(n) || 1)}"`);
  // Parts and objects without an extruder use filament 1 of their model.
  const head = next.split("<part")[0];
  if (!/key="extruder"/.test(head)) next = next.replace(`<object id="${id}">`, `<object id="${id}">\n    <metadata key="extruder" value="${toFilament(1)}"/>`);
  return `  ${next}`;
}

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import sanitizeHtml from "sanitize-html";
import { getDesign, MakerWorldError } from "@/lib/makerworld.ts";
import { publicSettings } from "@/lib/store.ts";
import { u1Filaments } from "@/lib/profiles.ts";
import { DEFAULT_OPTIONS, PRINT_MODES } from "@/lib/slicer.ts";
import { ModelView } from "@/components/ModelView";
import { mwImage } from "@/lib/format";

export default function ModelPage(props: PageProps<"/model/[id]">) {
  return (
    <Suspense fallback={<main className="container muted">Loading model from MakerWorld…</main>}>
      <ModelContent params={props.params} />
    </Suspense>
  );
}

const clean = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "img", "span", "blockquote", "code", "pre", "hr", "table", "tr", "td", "th", "thead", "tbody"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "loading", "referrerpolicy"] },
    allowedSchemes: ["https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
      // Description images are full-size originals too: ask the CDN for a 1200 px WebP.
      img: (_tag, attribs) => ({
        tagName: "img",
        attribs: { ...attribs, src: mwImage(attribs.src, 1200), loading: "lazy", referrerpolicy: "no-referrer" },
      }),
      h1: "h3",
      h2: "h3",
    },
  });

async function ModelContent({ params }: { params: PageProps<"/model/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const designId = Number(id);
  if (!Number.isInteger(designId) || designId <= 0) notFound();

  let design;
  try {
    design = await getDesign(designId);
  } catch (err) {
    if (err instanceof MakerWorldError && err.code === "not_found") notFound();
    return (
      <main className="container">
        <div className="notice error">Could not load this model from MakerWorld: {(err as Error).message}</div>
      </main>
    );
  }

  const settings = publicSettings();
  return (
    <>
      <title>{`${design.title} · U1 Maker Hub`}</title>
      <ModelView
        design={{
          ...design,
          summary: clean(design.summary),
          instances: design.instances.map((i) => ({ ...i, summary: clean(i.summary) })),
        }}
        settings={{ loggedIn: settings.loggedIn, printerConfigured: Boolean(settings.printerHost), tools: settings.tools }}
        modes={Object.entries(PRINT_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description }))}
        defaults={DEFAULT_OPTIONS}
        filamentPresets={u1Filaments()}
      />
    </>
  );
}

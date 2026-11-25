import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import sanitizeHtml from "sanitize-html";
import { getDesign, MakerWorldError } from "@/lib/makerworld.ts";
import { getModel, SnapmakerError } from "@/lib/snapmaker.ts";
import { isSourceId, siteForSource } from "@/lib/sites.ts";
import { publicSettings } from "@/lib/store.ts";
import { u1Filaments } from "@/lib/profiles.ts";
import { DEFAULT_OPTIONS, PRINT_MODES } from "@/lib/slicer.ts";
import { ModelView } from "@/components/ModelView";
import { SnapmakerModelView } from "@/components/SnapmakerModelView";
import { mwImage } from "@/lib/format";
import { t } from "@/lib/i18n";

export default function ModelPage(props: PageProps<"/model/[id]">) {
  return (
    <Suspense fallback={<main className="container muted">{t("model.loading")}</main>}>
      <ModelContent params={props.params} searchParams={props.searchParams} />
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
      // MakerWorld 的描述图片使用 CDN 缩放，其他来源保留原始图片地址。
      img: (_tag, attribs) => ({
        tagName: "img",
        attribs: { ...attribs, src: mwImage(attribs.src, 1200), loading: "lazy", referrerpolicy: "no-referrer" },
      }),
      h1: "h3",
      h2: "h3",
    },
  });

async function ModelContent({ params, searchParams }: PageProps<"/model/[id]">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const source = sp.source;
  const instanceParam = sp.instance;
  // 切换打印配置时把 instance 写回地址栏，刷新/分享不丢；其余参数原样保留。
  const baseQuery = Object.entries(sp)
    .filter(([key, value]) => key !== "instance" && typeof value === "string")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join("&");
  const settings = publicSettings();
  const site = isSourceId(source) ? siteForSource(source) : settings.site;
  if (!site) {
    let design;
    try {
      design = await getModel(id);
    } catch (err) {
      if (err instanceof SnapmakerError && (err.code === "not_found" || err.status === 400)) notFound();
      return (
        <main className="container">
          <div className="notice error">{t("snapmaker.loadError", { error: (err as Error).message })}</div>
        </main>
      );
    }
    return (
      <>
        <title>{`${design.title} · U1 Maker Hub`}</title>
        <SnapmakerModelView
          key={design.id}
          design={{ ...design, description: clean(design.description || design.translatedDescription) }}
          settings={{ printerConfigured: Boolean(settings.printerHost), tools: settings.tools }}
        />
      </>
    );
  }

  const designId = Number(id);
  if (!Number.isInteger(designId) || designId <= 0) notFound();

  let design;
  try {
    design = await getDesign(designId, site);
  } catch (err) {
    if (err instanceof MakerWorldError && err.code === "not_found") notFound();
    return (
      <main className="container">
        <div className="notice error">Could not load this model from MakerWorld: {(err as Error).message}</div>
      </main>
    );
  }

  return (
    <>
      <title>{`${design.title} · U1 Maker Hub`}</title>
      <ModelView
        key={`${site}:${design.id}`}
        site={site}
        design={{
          ...design,
          summary: clean(design.summary),
          instances: design.instances.map((i) => ({ ...i, summary: clean(i.summary) })),
        }}
        settings={{ loggedIn: settings.accounts[site].loggedIn, printerConfigured: Boolean(settings.printerHost), tools: settings.tools }}
        modes={Object.entries(PRINT_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description }))}
        defaults={DEFAULT_OPTIONS}
        filamentPresets={u1Filaments()}
        initialInstance={Number(instanceParam) || 0}
        baseQuery={baseQuery}
      />
    </>
  );
}

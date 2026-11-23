import { Suspense } from "react";
import { connection } from "next/server";
import { publicSettings } from "@/lib/store.ts";
import { DEFAULT_OPTIONS, PRINT_MODES } from "@/lib/slicer.ts";
import { UploadView } from "@/components/UploadView";

export const metadata = { title: "Upload · U1 Maker Hub" };

export default function UploadPage(props: PageProps<"/upload">) {
  return (
    <Suspense fallback={<main className="container muted">Loading…</main>}>
      <UploadContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function UploadContent({ searchParams }: { searchParams: PageProps<"/upload">["searchParams"] }) {
  await connection();
  const { id } = await searchParams;
  const settings = publicSettings();
  return (
    <UploadView
      settings={{ printerConfigured: Boolean(settings.printerHost), tools: settings.tools }}
      modes={Object.entries(PRINT_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description }))}
      defaults={DEFAULT_OPTIONS}
      initialId={typeof id === "string" ? id : null}
    />
  );
}

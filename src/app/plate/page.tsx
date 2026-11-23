import { Suspense } from "react";
import { connection } from "next/server";
import { publicSettings } from "@/lib/store.ts";
import { DEFAULT_OPTIONS, PRINT_MODES } from "@/lib/slicer.ts";
import { PlateView } from "@/components/PlateView";

export const metadata = { title: "Plate · U1 Maker Hub" };

export default function PlatePage() {
  return (
    <Suspense fallback={<main className="container muted">Loading the plate…</main>}>
      <PlateContent />
    </Suspense>
  );
}

async function PlateContent() {
  await connection();
  const settings = publicSettings();
  return (
    <PlateView
      settings={{ loggedIn: settings.loggedIn, printerConfigured: Boolean(settings.printerHost), tools: settings.tools }}
      modes={Object.entries(PRINT_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description }))}
      defaults={DEFAULT_OPTIONS}
    />
  );
}

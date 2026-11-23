import { Suspense } from "react";
import { connection } from "next/server";
import { publicSettings } from "@/lib/store.ts";
import { u1Filaments } from "@/lib/profiles.ts";
import { SettingsView } from "@/components/SettingsView";

export const metadata = { title: "Settings · U1 Maker Hub" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<main className="container muted">Loading settings…</main>}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  // Settings live in a local file and change at runtime: never prerender them.
  await connection();
  let filaments: string[] = [];
  try {
    filaments = u1Filaments();
  } catch {
    filaments = [];
  }
  return <SettingsView initial={publicSettings()} filaments={filaments} />;
}

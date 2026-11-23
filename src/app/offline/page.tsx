import type { Metadata } from "next";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("offline.title") };

export default function OfflinePage() {
  return (
    <main className="container">
      <section className="panel" style={{ maxWidth: 560 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{t("offline.heading")}</h1>
        <p className="muted">{t("offline.description")}</p>
        {/* A full page load, not a client navigation: it goes back through the network. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
          {t("offline.retry")}
        </a>
      </section>
    </main>
  );
}

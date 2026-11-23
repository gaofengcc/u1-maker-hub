import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · U1 Maker Hub" };

export default function OfflinePage() {
  return (
    <main className="container">
      <section className="panel" style={{ maxWidth: 560 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>You are offline</h1>
        <p className="muted">U1 Maker Hub needs the network to reach MakerWorld and your printer. Check your Wi-Fi, then try again.</p>
        {/* A full page load, not a client navigation: it goes back through the network. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
          Try again
        </a>
      </section>
    </main>
  );
}

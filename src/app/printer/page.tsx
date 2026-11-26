import { PrinterView } from "@/components/PrinterView";

export const metadata = { title: "我的打印机 · U1 模型工坊" };

export default function PrinterPage() {
  if (process.env.DEMO_MODE === "1") {
    return (
      <main className="container">
        <section className="panel" style={{ maxWidth: 620 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Snapmaker U1</h1>
          <p className="notice" style={{ marginBottom: 0 }}>演示模式，未连接打印机</p>
        </section>
      </main>
    );
  }
  return <PrinterView />;
}

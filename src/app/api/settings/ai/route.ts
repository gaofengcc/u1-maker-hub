import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/aiHints.ts";

/**
 * 测试 AI 接口连通性：发一句最小请求，返回模型名和耗时。
 * 只回传是否成功与错误摘要，绝不回传 key。
 */
export async function POST() {
  const config = aiConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: "还没配置 API key" });
  }
  const started = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 20,
        messages: [{ role: "user", content: "只回复两个字：可以" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - started;
    if (!response.ok) {
      const text = (await response.text()).slice(0, 200);
      return NextResponse.json({ ok: false, latency, error: `HTTP ${response.status}：${text}` });
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return NextResponse.json({
      ok: true,
      latency,
      model: config.model,
      reply: (payload.choices?.[0]?.message?.content ?? "").trim().slice(0, 40),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      latency: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

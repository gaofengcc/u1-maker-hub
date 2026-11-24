"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // 登录成功后清掉旧缓存，避免看到上一会话留下的页面。
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        router.replace(next.startsWith("/") ? next : "/");
        router.refresh();
        return;
      }
      setError(res.status === 429 ? "尝试太频繁，请稍后再试" : "密码不对");
      setPassword("");
    } catch {
      setError("连不上服务，请检查网络");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label htmlFor="password" style={{ fontSize: 13, color: "var(--muted, #666)" }}>
        访问密码
      </label>
      <input
        id="password"
        type="password"
        className="input"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoFocus
        autoComplete="current-password"
        placeholder="请输入密码"
        style={{ width: "100%", fontSize: 16 }}
      />
      {error && (
        <p style={{ margin: 0, color: "#c62828", fontSize: 14 }} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !password} style={{ width: "100%", padding: "10px 16px", fontSize: 15 }}>
        {busy ? "验证中…" : "进入"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="container" style={{ display: "flex", minHeight: "70vh", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: "100%", maxWidth: 360, padding: 24 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>U1 模型工坊</h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted, #666)" }}>
          需要密码才能进入
        </p>
        <Suspense fallback={<p style={{ fontSize: 14 }}>加载中…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

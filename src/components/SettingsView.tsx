"use client";

import { useState } from "react";
import type { ToolLoad } from "@/lib/slicer.ts";
import { api, DEFAULT_PRICE_PER_KG, formatDate, inkFor, mwImage } from "@/lib/format";
import { SITES, type SiteId } from "@/lib/sites";
import { t, tList } from "@/lib/i18n";

type PublicSettings = {
  site: SiteId;
  accounts: Record<string, { loggedIn: boolean; user: { uid?: string | number; name?: string; avatar?: string } | null; savedAt: string | null }>;
  loggedIn: boolean;
  bambuUser: { uid?: string | number; name?: string; avatar?: string } | null;
  tokenSavedAt: string | null;
  printerHost: string;
  haUrl: string;
  haPlug: string;
  haTokenSet: boolean;
  tools: ToolLoad[];
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiKeySet: boolean;
};

type LoginStep = { status: "ok" } | { status: "code"; email: string } | { status: "tfa"; tfaKey: string };

export function SettingsView({ initial, filaments }: { initial: PublicSettings; filaments: string[] }) {
  const [s, setS] = useState(initial);
  return (
    <main className="container" style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ margin: 0, fontSize: 26 }}>{t("settings.title")}</h1>
      <AccountPanel s={s} onChange={setS} />
      <PrinterPanel s={s} onChange={setS} />
      <AiPanel s={s} onChange={setS} />
      <PowerPanel s={s} onChange={setS} />
      <ToolsPanel s={s} onChange={setS} filaments={filaments} />
      <SessionPanel />
    </main>
  );
}

function SessionPanel() {
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/session/logout", { method: "POST" });
      // 清掉 Service Worker 缓存，免得退出后还能翻到上一会话的页面。
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      window.location.href = "/login";
    } catch {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (pwBusy) return;
    setPwMsg(null);
    if (next.length < 6) {
      setPwMsg({ kind: "err", text: "新密码至少 6 位" });
      return;
    }
    if (next !== confirm) {
      setPwMsg({ kind: "err", text: "两次输入的新密码不一致" });
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch("/api/session/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        setPwMsg({ kind: "ok", text: "密码已修改，其它设备上的登录已失效" });
      } else {
        setPwMsg({ kind: "err", text: data.error || "修改失败，请重试" });
      }
    } catch {
      setPwMsg({ kind: "err", text: "连不上服务，请检查网络" });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>登录状态</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        当前已登录。退出后需要重新输入访问密码才能使用。
      </p>
      <button type="button" className="btn" disabled={busy} onClick={logout}>
        {busy ? "退出中…" : "退出登录"}
      </button>

      <h3 style={{ margin: "20px 0 6px", fontSize: 16 }}>修改访问密码</h3>
      <p className="small muted" style={{ lineHeight: 1.5, marginTop: 0 }}>
        改完之后，这台设备保持登录，其它设备上的登录会立即失效，需要用新密码重新登录。
      </p>
      <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="当前密码"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="新密码（至少 6 位）"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="再输一次新密码"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={pwBusy || !current || !next || !confirm}>
          {pwBusy ? "提交中…" : "修改密码"}
        </button>
        {pwMsg && (
          <p
            role="status"
            className="small"
            style={{ margin: 0, color: pwMsg.kind === "ok" ? "#2e7d32" : "#c62828" }}
          >
            {pwMsg.text}
          </p>
        )}
      </form>
    </section>
  );
}

function AccountPanel({ s, onChange }: { s: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [tab, setTab] = useState<"password" | "code" | "token">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = s.accounts?.[s.site] ?? { loggedIn: s.loggedIn, user: s.bambuUser, savedAt: s.tokenSavedAt };

  const switchSite = async (site: SiteId) => {
    if (site === s.site) return;
    setError(null);
    try {
      onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ site }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const refresh = async () => onChange(await api<PublicSettings>("/api/settings"));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStep = async (r: LoginStep) => {
    if (r.status === "ok") {
      setStep(null);
      setPassword("");
      setCode("");
      await refresh();
    } else setStep(r);
  };

  const authBody = (extra: Record<string, string>) => JSON.stringify({ ...extra, site: s.site });

  if (account.loggedIn) {
    return (
      <section className="panel">
        <h2>{t("settings.accountTitle")}</h2>
        <SitePicker site={s.site} onChange={switchSite} />
        <p className="small muted">{t("settings.siteDescription")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {account.user?.avatar && <img className="avatar" style={{ width: 40, height: 40 }} src={mwImage(account.user.avatar, 96)} alt="" referrerPolicy="no-referrer" />}
          <div style={{ flex: 1 }}>
            <strong>{account.user?.name || t("settings.accountLoggedIn")}</strong>
            <p className="small muted">
              {t("settings.downloadsEnabled")}{account.savedAt ? ` ${t("settings.savedAt", { date: formatDate(account.savedAt) })}` : "。"}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => run(async () => onChange(await api<PublicSettings>(`/api/auth/token?site=${s.site}`, { method: "DELETE" })))}>
            {t("settings.logout")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>{t("settings.accountTitle")}</h2>
      <SitePicker site={s.site} onChange={switchSite} />
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        {t("settings.browseWithoutAccount")}
      </p>
      <div className="chips" role="tablist" aria-label={t("settings.loginMethod")}>
        {(
          [
            ["password", t("settings.passwordTab")],
            ["code", t("settings.codeTab")],
            ["token", t("settings.tokenTab")],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              setStep(null);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {step?.status === "tfa" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => handleStep(await api<LoginStep>("/api/auth/tfa", { method: "POST", body: authBody({ tfaKey: step.tfaKey, code }) })));
          }}
        >
          <label className="label" htmlFor="tfa">
            {t("settings.authenticatorCode")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="tfa" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary" disabled={busy}>
              {t("settings.verify")}
            </button>
          </div>
        </form>
      ) : step?.status === "code" || (tab === "code" && step) ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => handleStep(await api<LoginStep>("/api/auth/login", { method: "POST", body: authBody({ email, code }) })));
          }}
        >
          <label className="label" htmlFor="code">
            {t("settings.codeSent", { email })}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary" disabled={busy}>
              {t("settings.login")}
            </button>
          </div>
        </form>
      ) : tab === "password" ? (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => handleStep(await api<LoginStep>("/api/auth/login", { method: "POST", body: authBody({ email, password }) })));
          }}
        >
          <div className="field">
            <label className="label" htmlFor="email">
              {t("settings.email")}
            </label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              {t("settings.password")}
            </label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? t("settings.loggingIn") : t("settings.login")}
          </button>
          <p className="small muted">{t("settings.loginHint")}</p>
        </form>
      ) : tab === "code" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => setStep(await api<LoginStep>("/api/auth/code", { method: "POST", body: authBody({ email }) })));
          }}
        >
          <label className="label" htmlFor="email2">
            {t("settings.codeEmailHint")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="email2" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn btn-primary" disabled={busy}>
              {t("settings.sendCode")}
            </button>
          </div>
        </form>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              onChange(await api<PublicSettings>("/api/auth/token", { method: "POST", body: authBody({ token }) }));
              setToken("");
            });
          }}
        >
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{tList("settings.tokenInstructions").map((item) => <li key={item}>{item}</li>)}</ol>
          <label className="label" htmlFor="token">
            {t("settings.token")}
          </label>
          <textarea id="token" className="input" style={{ height: 90, padding: 10, fontFamily: "monospace", fontSize: 12 }} value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !token.trim()} style={{ alignSelf: "flex-start" }}>
            {t("settings.saveToken")}
          </button>
        </form>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function SitePicker({ site, onChange }: { site: SiteId; onChange: (site: SiteId) => void }) {
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <span className="label">{t("settings.siteTitle")}</span>
      <div className="chips" role="group" aria-label={t("settings.siteTitle")}>
        {(Object.keys(SITES) as SiteId[]).map((id) => (
          <button key={id} type="button" className="chip" aria-pressed={site === id} onClick={() => onChange(id)}>
            {SITES[id].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PrinterPanel({ s, onChange }: { s: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [host, setHost] = useState(s.printerHost);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ ok: boolean; error?: string; klippy?: string; version?: string }>("/api/printer/test", { method: "POST", body: JSON.stringify({ host }) });
      setResult(r.ok ? { ok: true, text: t("settings.connected", { state: r.klippy ?? "—", version: r.version ? ` · Moonraker ${r.version}` : "" }) } : { ok: false, text: r.error ?? t("settings.noAnswer") });
      if (r.ok) onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ printerHost: host }) }));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>{t("settings.printerTitle")}</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        {t("settings.printerDescription")}
      </p>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void test();
        }}
      >
        <label className="label" htmlFor="host">
          {t("settings.printerAddress")}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input id="host" className="input" style={{ flex: "1 1 240px" }} placeholder="192.168.1.42" value={host} onChange={(e) => setHost(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !host.trim()}>
            {busy ? t("settings.testing") : t("settings.testSave")}
          </button>
        </div>
      </form>
      {result && <div className={`notice ${result.ok ? "ok" : "error"}`}>{result.text}</div>}
    </section>
  );
}

/** Home Assistant access, for the power button on the printer page. Checking only reads the plug's state. */
function PowerPanel({ s, onChange }: { s: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [url, setUrl] = useState(s.haUrl);
  const [plug, setPlug] = useState(s.haPlug);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ haUrl: url, haPlug: plug, haToken: token }) }));
      setToken("");
      const p = await api<{ configured: boolean; state?: string; name?: string; entity?: string; error?: string }>("/api/printer/power");
      if (!p.configured) setResult({ ok: false, text: t("settings.powerSavedHint") });
      else if (p.error) setResult({ ok: false, text: p.error });
      else setResult({ ok: true, text: t("settings.powerConnected", { name: p.name ?? "Home Assistant", entity: p.entity ?? "—", state: p.state ?? "—" }) });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ haToken: null }) }));
    setResult(null);
  };

  return (
    <section className="panel">
      <h2>{t("settings.powerTitle")}</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        {t("settings.powerDescription")}
      </p>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="ha-url">
            {t("settings.homeAssistantAddress")}
          </label>
          <input id="ha-url" className="input" placeholder="http://homeassistant.local:8123" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ha-plug">
            {t("settings.plug")}
          </label>
          <input id="ha-plug" className="input" placeholder="switch.printer_plug" value={plug} onChange={(e) => setPlug(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ha-token">
            {t("settings.longLivedToken")}
          </label>
          <input
            id="ha-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={s.haTokenSet ? t("settings.replaceToken") : ""}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={busy || (!s.haTokenSet && !token.trim())}>
            {busy ? t("settings.checkingPower") : t("settings.saveCheck")}
          </button>
          {s.haTokenSet && (
            <button type="button" className="btn" onClick={() => void removeToken()}>
              {t("settings.removeToken")}
            </button>
          )}
        </div>
      </form>
      {result && <div className={`notice ${result.ok ? "ok" : "error"}`}>{result.text}</div>}
    </section>
  );
}

function ToolsPanel({ s, onChange, filaments }: { s: PublicSettings; onChange: (s: PublicSettings) => void; filaments: string[] }) {
  const [tools, setTools] = useState(s.tools);
  const [saved, setSaved] = useState(false);
  const update = (i: number, patch: Partial<ToolLoad>) => {
    setSaved(false);
    setTools(tools.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  };
  const save = async () => {
    onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ tools }) }));
    setSaved(true);
  };
  const plaFirst = [...filaments].sort((a, b) => Number(/PLA/.test(b)) - Number(/PLA/.test(a)) || a.localeCompare(b));
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Reads type and colour of what is loaded from the printer's RFID / filament settings.
  const syncFromPrinter = async () => {
    setSyncMsg(null);
    try {
      const st = await api<{ online: boolean; error?: string; tools?: { filament: { type: string; color: string; loaded: boolean } }[] }>("/api/printer/status");
      if (!st.online || !st.tools) throw new Error(st.error ?? t("settings.printerOffline"));
      const pick = (type: string, current: string) => {
        const t = type.toUpperCase();
        if (!t) return current;
        if (current.toUpperCase().includes(t)) return current;
        const exact = filaments.find((f) => f === `Snapmaker ${t} @U1`) ?? filaments.find((f) => f.startsWith("Snapmaker") && f.toUpperCase().includes(` ${t}`));
        if (t === "PLA") return "Snapmaker PLA SnapSpeed @U1";
        return exact ?? current;
      };
      setTools(tools.map((t, i) => {
        const f = st.tools![i]?.filament;
        return f && f.loaded ? { ...t, preset: pick(f.type, t.preset), color: f.color.toUpperCase() } : t;
      }));
      setSaved(false);
      setSyncMsg(t("settings.readPrinterHint"));
    } catch (e) {
      setSyncMsg((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <h2>{t("settings.toolsTitle")}</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        {t("settings.toolsDescription")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tools.map((tool, i) => (
          <div key={i} className="tool" style={{ flexWrap: "wrap" }}>
            <span className="tool-chip" style={{ background: tool.color, color: inkFor(tool.color) }}>
              T{i + 1}
            </span>
            <label className="sr-only" htmlFor={`fil-${i}`}>
              {t("settings.filamentIn", { i: i + 1 })}
            </label>
            <select id={`fil-${i}`} className="select" style={{ flex: "1 1 240px", width: "auto" }} value={tool.preset} onChange={(e) => update(i, { preset: e.target.value })}>
              {!filaments.includes(tool.preset) && <option value={tool.preset}>{tool.preset}</option>}
              {plaFirst.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {t("settings.color")}
              <input type="color" value={tool.color} onChange={(e) => update(i, { color: e.target.value.toUpperCase() })} style={{ width: 44, height: 36, border: 0, background: "none", cursor: "pointer" }} />
            </label>
            <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step={0.5}
                className="input"
                style={{ width: 80, height: 36 }}
                value={tool.pricePerKg ?? DEFAULT_PRICE_PER_KG}
                onChange={(e) => update(i, { pricePerKg: e.target.value === "" ? undefined : Number(e.target.value) })}
                aria-label={t("settings.priceAria", { i: i + 1 })}
              />
              {t("settings.eurosPerKg")}
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={save}>
          {t("settings.saveToolheads")}
        </button>
        <button type="button" className="btn" onClick={syncFromPrinter} disabled={!s.printerHost}>
          {t("settings.readPrinter")}
        </button>
        {saved && <span className="small" style={{ color: "var(--accent-ink)" }}>{t("settings.saved")}</span>}
        {syncMsg && <span className="small muted">{syncMsg}</span>}
      </div>
    </section>
  );
}
function AiPanel({ s, onChange }: { s: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [enabled, setEnabled] = useState(s.aiEnabled);
  const [baseUrl, setBaseUrl] = useState(s.aiBaseUrl);
  const [model, setModel] = useState(s.aiModel);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ aiEnabled: enabled, aiBaseUrl: baseUrl, aiModel: model, ...(key.trim() ? { aiKey: key.trim() } : {}) }),
      });
      onChange(next);
      setKey("");
      setMsg({ ok: true, text: "已保存" });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; latency?: number; model?: string; reply?: string; error?: string }>("/api/settings/ai", { method: "POST" });
      setMsg(r.ok
        ? { ok: true, text: `连接正常 · ${r.model ?? ""} · ${((r.latency ?? 0) / 1000).toFixed(1)} 秒 · 回复「${r.reply ?? ""}」` }
        : { ok: false, text: r.error ?? "连接失败" });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>AI 解析作者说明</h2>
      <p className="small muted" style={{ lineHeight: 1.6 }}>
        设计师常把层高、填充、支撑要求写在模型说明里，句式千变万化。开启后由大模型理解说明并提取这些提示，
        自动覆盖按几何推算的参数；每段说明只解析一次并缓存，失败时自动回落到关键词规则。
      </p>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">启用</span>
        <div className="chips" role="group">
          <button type="button" className="chip" aria-pressed={enabled} onClick={() => setEnabled(true)}>开启</button>
          <button type="button" className="chip" aria-pressed={!enabled} onClick={() => setEnabled(false)}>关闭</button>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">接口地址</span>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">模型</span>
        <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash" />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">API Key</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={s.aiKeySet ? "已设置（留空不修改）" : "粘贴 API key"}
        />
        <span className="small muted">只保存在本机 data/settings.json（权限 600），不会回传到页面。</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "处理中…" : "保存"}</button>
        <button type="button" className="btn" disabled={busy} onClick={test}>测试连接</button>
        {s.aiKeySet && <button type="button" className="btn" disabled={busy} onClick={async () => {
          const next = await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ aiKey: null }) });
          onChange(next);
          setMsg({ ok: true, text: "已清除 API key" });
        }}>清除 key</button>}
      </div>
      {msg && <p className="small" style={{ color: msg.ok ? "var(--ok, #2e7d32)" : "var(--err, #c62828)", marginTop: 10 }}>{msg.text}</p>}
    </section>
  );
}

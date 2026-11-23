"use client";

import { useState } from "react";
import type { ToolLoad } from "@/lib/slicer.ts";
import { api, DEFAULT_PRICE_PER_KG, inkFor, mwImage } from "@/lib/format";

type PublicSettings = {
  loggedIn: boolean;
  bambuUser: { name?: string; avatar?: string } | null;
  tokenSavedAt: string | null;
  printerHost: string;
  haUrl: string;
  haPlug: string;
  haTokenSet: boolean;
  tools: ToolLoad[];
};

type LoginStep = { status: "ok" } | { status: "code"; email: string } | { status: "tfa"; tfaKey: string };

export function SettingsView({ initial, filaments }: { initial: PublicSettings; filaments: string[] }) {
  const [s, setS] = useState(initial);
  return (
    <main className="container" style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ margin: 0, fontSize: 26 }}>Settings</h1>
      <AccountPanel s={s} onChange={setS} />
      <PrinterPanel s={s} onChange={setS} />
      <PowerPanel s={s} onChange={setS} />
      <ToolsPanel s={s} onChange={setS} filaments={filaments} />
    </main>
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

  if (s.loggedIn) {
    return (
      <section className="panel">
        <h2>MakerWorld account</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.bambuUser?.avatar && <img className="avatar" style={{ width: 40, height: 40 }} src={mwImage(s.bambuUser.avatar, 96)} alt="" referrerPolicy="no-referrer" />}
          <div style={{ flex: 1 }}>
            <strong>{s.bambuUser?.name || "Logged in"}</strong>
            <p className="small muted">
              Downloads are enabled. Bambu logins last about 90 days
              {s.tokenSavedAt ? ` (saved ${new Date(s.tokenSavedAt).toLocaleDateString()})` : ""}.
            </p>
          </div>
          <button type="button" className="btn" onClick={() => run(async () => onChange(await api<PublicSettings>("/api/auth/token", { method: "DELETE" })))}>
            Log out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>MakerWorld account</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        Browsing works without an account, but MakerWorld only lets logged-in users download files. Log in with your Bambu Lab account. Your credentials go only to
        Bambu Lab; this app keeps just the resulting token, on this computer.
      </p>
      <div className="chips" role="tablist" aria-label="Login method">
        {(
          [
            ["password", "Email & password"],
            ["code", "Email code"],
            ["token", "Paste a token"],
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
            run(async () => handleStep(await api<LoginStep>("/api/auth/tfa", { method: "POST", body: JSON.stringify({ tfaKey: step.tfaKey, code }) })));
          }}
        >
          <label className="label" htmlFor="tfa">
            Code from your authenticator app
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="tfa" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary" disabled={busy}>
              Verify
            </button>
          </div>
        </form>
      ) : step?.status === "code" || (tab === "code" && step) ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => handleStep(await api<LoginStep>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, code }) })));
          }}
        >
          <label className="label" htmlFor="code">
            Bambu sent a code to {email}. Enter it here.
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary" disabled={busy}>
              Log in
            </button>
          </div>
        </form>
      ) : tab === "password" ? (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => handleStep(await api<LoginStep>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })));
          }}
        >
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? "Logging in…" : "Log in"}
          </button>
          <p className="small muted">If Bambu asks for a code sent by email or from an authenticator app, a field appears here.</p>
        </form>
      ) : tab === "code" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => setStep(await api<LoginStep>("/api/auth/code", { method: "POST", body: JSON.stringify({ email }) })));
          }}
        >
          <label className="label" htmlFor="email2">
            Email (for Google or Apple sign-in accounts too)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="email2" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn btn-primary" disabled={busy}>
              Send code
            </button>
          </div>
        </form>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              onChange(await api<PublicSettings>("/api/auth/token", { method: "POST", body: JSON.stringify({ token }) }));
              setToken("");
            });
          }}
        >
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Log in on makerworld.com in your browser.</li>
            <li>Open the developer tools, then Application (Chrome) or Storage (Firefox), then Cookies, then makerworld.com.</li>
            <li>Copy the value of the cookie named “token” and paste it below.</li>
          </ol>
          <label className="label" htmlFor="token">
            Token
          </label>
          <textarea id="token" className="input" style={{ height: 90, padding: 10, fontFamily: "monospace", fontSize: 12 }} value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !token.trim()} style={{ alignSelf: "flex-start" }}>
            Save token
          </button>
        </form>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
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
      setResult(r.ok ? { ok: true, text: `Connected. Firmware state: ${r.klippy}${r.version ? ` · Moonraker ${r.version}` : ""}.` } : { ok: false, text: r.error ?? "No answer." });
      if (r.ok) onChange(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ printerHost: host }) }));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Printer</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        The address of your Snapmaker U1 on your network. Find it on the printer screen under Settings, then Network. Usually just the IP, like 192.168.1.42.
      </p>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void test();
        }}
      >
        <label className="label" htmlFor="host">
          Printer address
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input id="host" className="input" style={{ flex: "1 1 240px" }} placeholder="192.168.1.42" value={host} onChange={(e) => setHost(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !host.trim()}>
            {busy ? "Testing…" : "Test & save"}
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
      if (!p.configured) setResult({ ok: false, text: "Saved. Set the address, plug and token to use the power button." });
      else if (p.error) setResult({ ok: false, text: p.error });
      else setResult({ ok: true, text: `Connected. ${p.name} (${p.entity}) is ${p.state}.` });
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
      <h2>Printer power</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        Turns the printer&apos;s smart plug on and off from the printer page, through Home Assistant. Create a long-lived access token in Home Assistant under your
        profile, then Security. The plug is its entity id (switch.…) or the id at the end of its device page address.
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
            Home Assistant address
          </label>
          <input id="ha-url" className="input" placeholder="http://homeassistant.local:8123" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ha-plug">
            Plug
          </label>
          <input id="ha-plug" className="input" placeholder="switch.printer_plug" value={plug} onChange={(e) => setPlug(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ha-token">
            Long-lived access token
          </label>
          <input
            id="ha-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={s.haTokenSet ? "Saved. Paste a new one to replace it." : ""}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={busy || (!s.haTokenSet && !token.trim())}>
            {busy ? "Checking…" : "Save & check"}
          </button>
          {s.haTokenSet && (
            <button type="button" className="btn" onClick={() => void removeToken()}>
              Remove token
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
      if (!st.online || !st.tools) throw new Error(st.error ?? "The printer is offline.");
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
      setSyncMsg("Read from the printer. Check, then save.");
    } catch (e) {
      setSyncMsg((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <h2>What is loaded in each toolhead</h2>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        The slicer uses these filament profiles, and model colors are matched to these colors. Snapmaker PLA SnapSpeed is tuned for fast printing. The price
        per kilo of each spool gives the cost shown on models and prints.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tools.map((t, i) => (
          <div key={i} className="tool" style={{ flexWrap: "wrap" }}>
            <span className="tool-chip" style={{ background: t.color, color: inkFor(t.color) }}>
              T{i + 1}
            </span>
            <label className="sr-only" htmlFor={`fil-${i}`}>
              Filament in T{i + 1}
            </label>
            <select id={`fil-${i}`} className="select" style={{ flex: "1 1 240px", width: "auto" }} value={t.preset} onChange={(e) => update(i, { preset: e.target.value })}>
              {!filaments.includes(t.preset) && <option value={t.preset}>{t.preset}</option>}
              {plaFirst.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Color
              <input type="color" value={t.color} onChange={(e) => update(i, { color: e.target.value.toUpperCase() })} style={{ width: 44, height: 36, border: 0, background: "none", cursor: "pointer" }} />
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
                value={t.pricePerKg ?? DEFAULT_PRICE_PER_KG}
                onChange={(e) => update(i, { pricePerKg: e.target.value === "" ? undefined : Number(e.target.value) })}
                aria-label={`Price of the filament in T${i + 1}, euros per kilo`}
              />
              €/kg
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={save}>
          Save toolheads
        </button>
        <button type="button" className="btn" onClick={syncFromPrinter} disabled={!s.printerHost}>
          Read from printer
        </button>
        {saved && <span className="small" style={{ color: "var(--accent-ink)" }}>Saved</span>}
        {syncMsg && <span className="small muted">{syncMsg}</span>}
      </div>
    </section>
  );
}

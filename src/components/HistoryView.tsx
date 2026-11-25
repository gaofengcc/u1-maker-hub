"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import type { FailReason, HistoryRecord, HistoryState } from "@/lib/history";

type ModelStat = {
  modelName: string;
  count: number;
  success: number;
  failed: number;
  successRate: number;
  averageMinutes: number;
  averageFilamentGrams: number;
};
type Stats = {
  total: number;
  successRate: number;
  totalFilamentGrams: number;
  totalMinutes: number;
  averageMinutes: number;
  models: ModelStat[];
  failures: Record<string, number>;
};

const STATES: Array<HistoryState | ""> = ["", "done", "failed", "aborted", "unknown"];
const REASONS: Array<FailReason> = ["adhesion", "stringing", "clog", "warp", "support", "other"];

function formatMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function stateLabel(state: HistoryState) {
  return t(`history.${state}`);
}

function reasonLabel(reason?: string | null) {
  return t(reason ? `history.reasonLabels.${reason}` : "history.reasonLabels.none");
}

export function HistoryView() {
  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<HistoryState | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftReason, setDraftReason] = useState<FailReason | "">("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (selectedState: HistoryState | "") => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (selectedState) query.set("state", selectedState);
      const response = await fetch(`/api/history?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { items?: HistoryRecord[]; stats?: Stats };
      setItems(result.items ?? []);
      setStats(result.stats ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(state);
  }, [load, state]);

  const failureTotal = useMemo(() => Object.values(stats?.failures ?? {}).reduce((sum, count) => sum + count, 0), [stats]);
  const openEditor = (item: HistoryRecord) => {
    setEditing(item.id);
    setDraftReason(item.failReason ?? "");
    setDraftNote(item.note ?? "");
  };
  const save = async (item: HistoryRecord) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/history/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failReason: draftReason || null, note: draftNote }),
      });
      if (!response.ok) throw new Error("save");
      setEditing(null);
      await load(state);
    } catch {
      setError(t("history.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const cards = stats
    ? [
        [t("history.totalPrints"), String(stats.total)],
        [t("history.successRate"), `${Math.round(stats.successRate * 100)}%`],
        [t("history.totalFilament"), `${stats.totalFilamentGrams.toFixed(1)} g`],
        [t("history.totalTime"), formatMinutes(stats.totalMinutes)],
        [t("history.averageTime"), formatMinutes(stats.averageMinutes)],
      ]
    : [];

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 26 }}>{t("history.title")}</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>{t("history.subtitle")}</p>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}

      <section aria-label={t("history.title")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {cards.map(([label, value]) => (
          <div className="panel" key={label} style={{ gap: 6 }}>
            <span className="small muted">{label}</span>
            <strong style={{ fontSize: 24 }}>{loading ? "…" : value}</strong>
          </div>
        ))}
      </section>

      {stats && stats.total > 0 && (
        <>
          <section className="panel">
            <h2>{t("history.models")}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("history.model")}</th><th>{t("history.count")}</th><th>{t("history.success")}</th><th>{t("history.failedCount")}</th><th>{t("history.successRate")}</th><th>{t("history.average")}</th><th>{t("history.filament")}</th></tr></thead>
                <tbody>{stats.models.map((model) => <tr key={model.modelName}><td>{model.modelName}</td><td>{model.count}</td><td>{model.success}</td><td>{model.failed}</td><td>{Math.round(model.successRate * 100)}%</td><td>{formatMinutes(model.averageMinutes)}</td><td>{model.averageFilamentGrams.toFixed(1)} g</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>{t("history.failures")}</h2>
            {failureTotal === 0 ? <p className="muted">{t("history.noFailure")}</p> : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{Object.entries(stats.failures).sort((a, b) => b[1] - a[1]).map(([reason, count]) => <div key={reason} style={{ display: "grid", gridTemplateColumns: "100px 1fr 32px", gap: 10, alignItems: "center" }}><span className="small">{reasonLabel(reason)}</span><span style={{ height: 9, borderRadius: 99, background: "var(--danger-soft)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.round((count / failureTotal) * 100)}%`, background: "var(--danger)" }} /></span><strong className="small">{count}</strong></div>)}</div>}
          </section>
        </>
      )}

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2>{t("history.details")}</h2>
          <label><span className="sr-only">{t("history.status")}</span><select className="select" style={{ width: "auto" }} value={state} onChange={(event) => setState(event.target.value as HistoryState | "")}>
            {STATES.map((value) => <option key={value || "all"} value={value}>{value ? stateLabel(value) : t("history.allStates")}</option>)}
          </select></label>
        </div>
        {loading ? <p className="muted">…</p> : items.length === 0 ? <div><p style={{ margin: 0 }}>{t("history.noRecords")}</p><p className="muted small" style={{ margin: "6px 0 0" }}>{t("history.noRecordsHint")}</p></div> : <div className="table-wrap"><table><thead><tr><th>{t("history.time")}</th><th>{t("history.model")}</th><th>{t("history.status")}</th><th>{t("history.reason")}</th><th>{t("history.average")}</th><th>{t("history.filament")}</th><th>{t("history.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="small">{formatDate(item.at)}</td><td>{item.modelName || (item.instanceId != null ? t("history.instance", { id: item.instanceId }) : t("history.noModel"))}</td><td><span className={`badge ${item.state === "done" ? "green" : item.state === "failed" ? "red" : ""}`}>{stateLabel(item.state)}</span></td><td>{editing === item.id ? <select className="select" value={draftReason} onChange={(event) => setDraftReason(event.target.value as FailReason | "")}><option value="">{t("history.reasonPlaceholder")}</option>{REASONS.map((reason) => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}</select> : reasonLabel(item.failReason)}</td><td>{formatMinutes(item.actualMinutes ?? 0)}</td><td>{item.filamentGrams == null ? "—" : `${item.filamentGrams.toFixed(1)} g`}</td><td>{editing === item.id ? <div style={{ display: "flex", gap: 6, flexDirection: "column" }}><input className="input" value={draftNote} placeholder={t("history.notePlaceholder")} onChange={(event) => setDraftNote(event.target.value)} /><span style={{ display: "flex", gap: 6 }}><button className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save(item)}>{t("history.save")}</button><button className="btn btn-sm" disabled={saving} onClick={() => setEditing(null)}>{t("history.cancel")}</button></span></div> : <button className="btn btn-sm" onClick={() => openEditor(item)}>{t("history.edit")}</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}

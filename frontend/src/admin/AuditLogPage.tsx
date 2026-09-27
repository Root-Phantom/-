// ---- لاگ سامانه: چه کسی، چه زمانی، چه کاری انجام داد ----
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { AuditEntry } from "../types";
import { ErrorBox, Loading, Modal, Pager, fa, shamsi, useToast } from "../ui";

type Summary = Awaited<ReturnType<typeof api.auditSummary>>;

export default function AuditLogPage() {
  const toast = useToast();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actions, setActions] = useState<{ value: string; label: string }[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback(
    () => ({
      q, action, status,
      date_from: from ? `${from}T00:00:00` : undefined,
      date_to: to ? `${to}T23:59:59` : undefined,
    }),
    [q, action, status, from, to],
  );

  const load = useCallback(async () => {
    try {
      const r = await api.audit({ ...params(), page, page_size: 50 });
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [params, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.auditActions().then(setActions).catch(() => {}); }, []);
  useEffect(() => { api.auditSummary(days).then(setSummary).catch(() => {}); }, [days]);

  const maxUser = Math.max(1, ...(summary?.by_user.map((u) => u.count) || [1]));
  const maxAction = Math.max(1, ...(summary?.by_action.map((u) => u.count) || [1]));

  return (
    <div className="page">
      {summary && (
        <div className="row" style={{ alignItems: "stretch", marginBottom: 12 }}>
          <div className="card grow" style={{ marginBottom: 0, minWidth: 260 }}>
            <h3 style={{ justifyContent: "space-between" }}>
              <span>👥 فعال‌ترین کاربران</span>
              <select className="select" style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>۲۴ ساعت اخیر</option>
                <option value={7}>۷ روز اخیر</option>
                <option value={30}>۳۰ روز اخیر</option>
                <option value={365}>یک سال اخیر</option>
              </select>
            </h3>
            <div className="tiny muted" style={{ marginBottom: 6 }}>مجموع رویدادها: {fa(summary.total)}</div>
            {summary.by_user.slice(0, 8).map((u) => (
              <div className="bar-row" key={u.username}>
                <span className="name">{u.username}</span>
                <span className="track"><span className="fill" style={{ width: `${(u.count / maxUser) * 100}%`, display: "block" }} /></span>
                <span className="n">{fa(u.count)}</span>
              </div>
            ))}
          </div>
          <div className="card grow" style={{ marginBottom: 0, minWidth: 260 }}>
            <h3>📊 پرتکرارترین رویدادها</h3>
            {summary.by_action.slice(0, 8).map((a) => (
              <div className="bar-row" key={a.action}>
                <span className="name">{a.label}</span>
                <span className="track"><span className="fill" style={{ width: `${(a.count / maxAction) * 100}%`, display: "block" }} /></span>
                <span className="n">{fa(a.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field grow" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>جست‌وجو در شرح یا کاربر</label>
            <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 170 }}>
            <label>نوع رویداد</label>
            <select className="select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">همه</option>
              {actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, width: 110 }}>
            <label>نتیجه</label>
            <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">همه</option>
              <option value="success">موفق</option>
              <option value="failed">ناموفق</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, width: 145 }}>
            <label>از تاریخ</label>
            <input className="input ltr" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 145 }}>
            <label>تا تاریخ</label>
            <input className="input ltr" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <button
            className="btn"
            onClick={() => api.exportAudit(params()).catch((e) => toast(e.message, "err"))}
          >
            📤 خروجی CSV
          </button>
        </div>
        <ErrorBox msg={error} />
        {!items ? <Loading /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="grid stack-mobile">
              <thead>
                <tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>شرح</th><th>IP</th><th>نتیجه</th></tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} onClick={() => setDetail(r)} style={{ cursor: "pointer" }}>
                    <td data-label="زمان" className="tiny nowrap">{shamsi(r.created_at)}</td>
                    <td data-label="کاربر"><strong>{r.username}</strong></td>
                    <td data-label="رویداد"><span className="badge badge-primary">{r.action_label || r.action}</span></td>
                    <td data-label="شرح" style={{ maxWidth: 520, whiteSpace: "normal" }}>{r.summary}</td>
                    <td data-label="IP" className="mono">{r.ip_address || "—"}</td>
                    <td data-label="نتیجه"><span className={`badge ${r.status === "success" ? "badge-success" : "badge-danger"}`}>{r.status === "success" ? "موفق" : "ناموفق"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer" style={{ border: 0, padding: "8px 0 0" }}>
          <Pager page={page} pageSize={50} total={total} onPage={setPage} />
        </div>
      </div>

      {detail && (
        <Modal title="جزئیات رویداد" subtitle={`شناسه ${detail.id}`} onClose={() => setDetail(null)} size="wide">
          <table className="popup-table" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>زمان</td><td>{shamsi(detail.created_at)}</td></tr>
              <tr><td>کاربر</td><td>{detail.username}</td></tr>
              <tr><td>رویداد</td><td>{detail.action_label}</td></tr>
              <tr><td>شرح</td><td>{detail.summary}</td></tr>
              <tr><td>موجودیت</td><td className="mono">{detail.entity_type} {detail.entity_id}</td></tr>
              <tr><td>IP / مسیر</td><td className="mono">{detail.ip_address} {detail.method} {detail.path}</td></tr>
            </tbody>
          </table>
          {detail.payload && (
            <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 6, overflow: "auto", whiteSpace: "pre-wrap", textAlign: "left" }}>
              {JSON.stringify(detail.payload, null, 2)}
            </pre>
          )}
        </Modal>
      )}
    </div>
  );
}

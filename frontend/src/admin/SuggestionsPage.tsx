// ---- بررسی پیشنهادهای نام شهروندان ----
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { FieldDef, Suggestion } from "../types";
import { Empty, ErrorBox, Loading, Modal, Pager, STATUS_LABEL, fa, shamsi, useToast } from "../ui";

export default function SuggestionsPage({ onChanged, onShowFeature }: { onChanged: () => void; onShowFeature: (id: string) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [review, setReview] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.suggestions({ status, page, page_size: 25 });
      setItems(r.items);
      setTotal(r.total);
      setStats(await api.suggestionStats());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 14, height: "100%", overflow: "auto" }}>
      <div className="stat-grid">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <div
            key={s}
            className="stat"
            onClick={() => { setStatus(s); setPage(1); }}
            style={{ cursor: "pointer", borderColor: status === s ? "var(--primary)" : undefined }}
          >
            <div className="v">{fa(stats[s] || 0)}</div>
            <div className="k">{STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <ErrorBox msg={error} />
        {!items ? <Loading /> : items.length === 0 ? (
          <Empty icon="💡" text={`پیشنهادی با وضعیت «${STATUS_LABEL[status]}» وجود ندارد.`} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="grid">
              <thead>
                <tr><th>تاریخ</th><th>معبر (نام فعلی)</th><th>نام پیشنهادی</th><th>دلیل</th><th>پیشنهاددهنده</th><th>وضعیت</th><th>عملیات</th></tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td className="tiny nowrap">{shamsi(s.created_at)}</td>
                    <td>{s.feature_label || "—"}</td>
                    <td><strong>{s.suggested_name}</strong></td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal" }} className="tiny">{s.reason || "—"}</td>
                    <td className="tiny">{s.submitter_name || "ناشناس"}<div className="mono">{s.submitter_phone}</div></td>
                    <td>
                      <span className={`badge ${s.status === "approved" ? "badge-success" : s.status === "rejected" ? "badge-danger" : "badge-warn"}`}>{STATUS_LABEL[s.status]}</span>
                      {s.reviewed_by_name && <div className="tiny muted">{s.reviewed_by_name}</div>}
                    </td>
                    <td className="nowrap">
                      {s.feature_id && <button className="btn btn-sm btn-ghost" onClick={() => onShowFeature(s.feature_id!)} title="نمایش روی نقشه">🗺</button>}
                      {s.status === "pending" && <button className="btn btn-sm btn-primary" onClick={() => setReview(s)}>بررسی</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer" style={{ border: 0, padding: "8px 0 0" }}>
          <Pager page={page} pageSize={25} total={total} onPage={setPage} />
        </div>
      </div>

      {review && (
        <ReviewModal
          s={review}
          onClose={() => setReview(null)}
          onDone={(msg) => { setReview(null); toast(msg, "ok"); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function ReviewModal({ s, onClose, onDone }: { s: Suggestion; onClose: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [applyTo, setApplyTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!s.feature_id) return;
    api.feature(s.feature_id)
      .then(async (f) => {
        const [fs, layers] = await Promise.all([api.fields(f.layer_id), api.layers(true)]);
        const text = fs.filter((x) => x.data_type === "text");
        setFields(text);
        const lf = layers.find((l) => l.id === f.layer_id)?.label_field;
        setApplyTo(lf && text.some((x) => x.key === lf) ? lf : text[0]?.key || "");
      })
      .catch(() => {});
  }, [s.feature_id]);

  const act = async (st: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewSuggestion(s.id, {
        status: st,
        admin_note: note || null,
        apply_to_field: st === "approved" && applyTo ? applyTo : null,
      });
      onDone(st === "approved" ? "پیشنهاد تأیید شد." : "پیشنهاد رد شد.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="بررسی پیشنهاد نام"
      subtitle={`«${s.suggested_name}» برای «${s.feature_label || "—"}»`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy} onClick={() => act("approved")}>✔ تأیید{applyTo ? " و اعمال نام" : ""}</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => act("rejected")}>✕ رد</button>
          <button className="btn" onClick={onClose}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      {s.reason && <div className="alert alert-info">دلیل: {s.reason}</div>}
      {fields.length > 0 && (
        <div className="field">
          <label>در صورت تأیید، نام در این ستون ثبت شود</label>
          <select className="select" value={applyTo} onChange={(e) => setApplyTo(e.target.value)}>
            <option value="">— فقط تأیید، بدون تغییر عارضه —</option>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>یادداشت مدیر (مثلاً شماره مصوبه)</label>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

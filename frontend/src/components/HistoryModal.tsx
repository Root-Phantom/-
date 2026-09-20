// ---- تاریخچه تغییرات یک عارضه ----
import { useEffect, useState } from "react";

import { api } from "../api";
import type { FieldDef, Revision } from "../types";
import { Empty, ErrorBox, Loading, Modal, cellText, fa, shamsi } from "../ui";

const ACTION: Record<string, { label: string; cls: string }> = {
  create: { label: "ایجاد", cls: "badge-success" },
  update: { label: "ویرایش", cls: "badge-primary" },
  archive: { label: "آرشیو", cls: "badge-warn" },
  restore: { label: "بازگردانی", cls: "badge-success" },
};

export default function HistoryModal({
  featureId, title, fields, onClose,
}: {
  featureId: string;
  title: string;
  fields: FieldDef[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.history(featureId).then(setItems).catch((e) => setError(e.message));
  }, [featureId]);

  const label = (k: string) => fields.find((f) => f.key === k)?.label || k;

  return (
    <Modal title="تاریخچه تغییرات" subtitle={title} onClose={onClose} size="wide">
      <ErrorBox msg={error} />
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <Empty text="تغییری پس از درون‌ریزی برای این عارضه ثبت نشده است." />
      )}
      {items && items.length > 0 && (
        <div className="timeline">
          {items.map((r) => {
            const a = ACTION[r.action] || { label: r.action, cls: "badge-muted" };
            return (
              <div className="tl-item" key={r.id}>
                <div className="tl-head">
                  <span className={`badge ${a.cls}`}>{a.label}</span>
                  <strong>{r.user_name}</strong>
                  <span className="muted tiny">{shamsi(r.created_at)}</span>
                  <span className="muted tiny">نسخه {fa(r.version)}</span>
                </div>
                <div className="tl-body">
                  {r.action === "update" &&
                    r.changed_fields.map((k) => (
                      <div key={k} className="diff">
                        <span>{label(k)}:</span>
                        <span className="old">{cellText(r.attributes_before?.[k]) || "—"}</span>
                        <span>←</span>
                        <span className="new">{cellText(r.attributes_after?.[k]) || "—"}</span>
                      </div>
                    ))}
                  {r.geometry_changed && <div>هندسه روی نقشه تغییر کرد.</div>}
                  {r.note && <div>📝 {r.note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ---- فرم ویرایش/ایجاد جدول توصیفی یک عارضه (نام‌گذاری معابر) ----
import { useState } from "react";

import type { FieldDef } from "../types";
import { ErrorBox, Modal, TYPE_LABEL } from "../ui";

export interface FeatureEditorProps {
  title: string;
  subtitle?: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  /** در حالت ایجاد، همه مقادیر (حتی بدون تغییر) ارسال می‌شوند */
  isNew?: boolean;
  onSave: (attributes: Record<string, unknown>, note: string) => Promise<void>;
  onClose: () => void;
}

export default function FeatureEditor({
  title, subtitle, fields, initial, isNew = false, onSave, onClose,
}: FeatureEditorProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const cur = initial[f.key];
      v[f.key] = cur ?? (isNew ? f.default_value ?? "" : "");
    }
    return v;
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setError(null);
    for (const f of fields) {
      const v = values[f.key];
      if (f.is_required && (v === "" || v === null || v === undefined)) {
        setError(`ستون «${f.label}» اجباری است.`);
        return;
      }
    }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const after = values[f.key] ?? "";
      if (isNew) {
        if (after !== "") out[f.key] = after;
        continue;
      }
      // در ویرایش فقط ستون‌های تغییریافته ارسال می‌شوند
      const before = initial[f.key] ?? "";
      if (String(before) !== String(after)) out[f.key] = after === "" ? null : after;
    }
    setBusy(true);
    try {
      await onSave(out, note);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const renderInput = (f: FieldDef) => {
    const v = values[f.key];
    switch (f.data_type) {
      case "boolean":
        return (
          <select
            className="select"
            value={v === true || v === "true" ? "true" : v === false || v === "false" ? "false" : ""}
            onChange={(e) => set(f.key, e.target.value === "" ? "" : e.target.value === "true")}
          >
            <option value="">—</option>
            <option value="true">بله</option>
            <option value="false">خیر</option>
          </select>
        );
      case "select":
        return (
          <select className="select" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case "number":
      case "integer":
        return (
          <input
            className="input ltr"
            type="number"
            step={f.data_type === "integer" ? 1 : "any"}
            value={String(v ?? "")}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
      case "date":
        return (
          <input className="input ltr" type="date" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
        );
      default:
        return <input className="input" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />;
    }
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : "ذخیره"}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      {fields.length === 0 ? (
        <div className="alert alert-info">
          این لایه هنوز ستونی ندارد. از بخش «لایه‌ها و ستون‌ها» ستون تعریف کنید.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" }}>
          {fields.map((f) => (
            <div className="field" key={f.key}>
              <label>
                {f.label}
                {f.is_required && <span className="req">*</span>}
                <span className="muted tiny"> — {TYPE_LABEL[f.data_type]}{f.unit ? ` (${f.unit})` : ""}</span>
              </label>
              {renderInput(f)}
            </div>
          ))}
        </div>
      )}
      {!isNew && (
        <div className="field" style={{ marginTop: 6 }}>
          <label>توضیح تغییر (در تاریخچه ثبت می‌شود)</label>
          <input
            className="input"
            placeholder="مثلاً: نام‌گذاری بر اساس مصوبه شورای شهر"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}

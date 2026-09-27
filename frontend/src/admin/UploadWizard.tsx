// ---- آپلود و درون‌ریزی شیپ‌فایل معابر ----
import { useEffect, useState } from "react";

import { api } from "../api";
import type { ImportJob, Layer, ShapefilePreview } from "../types";
import { ErrorBox, GEOM_LABEL, TYPE_LABEL, cellText, fa, shamsi, useToast } from "../ui";

export default function UploadWizard({ onImported }: { onImported: (layerId: string) => void }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ShapefilePreview | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [layerName, setLayerName] = useState("");
  const [target, setTarget] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [labelField, setLabelField] = useState("");
  const [srid, setSrid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ detail: string; layer_id: string; new_fields: string[] } | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);

  const loadJobs = () => api.importJobs().then(setJobs).catch(() => {});

  useEffect(() => {
    api.layers().then(setLayers).catch(() => {});
    loadJobs();
  }, []);

  const doPreview = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.previewShapefile(file);
      setPreview(p);
      setLayerName(file.name.replace(/\.(zip|shp)$/i, ""));
      setSrid(p.source_srid ? String(p.source_srid) : "");
      const guess = p.fields.find((f) => f.data_type === "text" && /نام|name/i.test(f.source_name));
      setLabelField(guess?.source_name || "");
      setSkip(new Set());
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.importShapefile({
        token: preview.token,
        layer_name: layerName || preview.filename,
        target_layer_id: target || null,
        skip_fields: Array.from(skip),
        label_field: labelField || null,
        source_srid: srid ? Number(srid) : null,
      });
      setResult(r);
      setStep(3);
      toast(r.detail, "ok");
      loadJobs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const toggleSkip = (name: string) =>
    setSkip((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 980, margin: "0 auto 14px" }}>
        <div className="steps">
          {["انتخاب فایل", "بررسی و نگاشت ستون‌ها", "پایان"].map((s, i) => (
            <div key={s} data-n={i + 1} className={`step ${step > i + 1 ? "done" : step === i + 1 ? "active" : ""}`}>{s}</div>
          ))}
        </div>

        <ErrorBox msg={error} />

        {step === 1 && (
          <>
            <div className="alert alert-info">
              همه فایل‌های شیپ‌فایل (<span className="mono">.shp .shx .dbf .prj .cpg</span>) را در یک فایل ZIP قرار دهید.
              رمزگذاری فارسی (UTF-8 یا Windows-1256) و سیستم تصویر به صورت خودکار تشخیص داده می‌شود.
            </div>
            <div className="field">
              <label>فایل ZIP شیپ‌فایل</label>
              <input className="input" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <button className="btn btn-primary" onClick={doPreview} disabled={!file || busy}>
              {busy ? <><span className="spinner" /> در حال خواندن…</> : "آپلود و پیش‌نمایش"}
            </button>
          </>
        )}

        {step === 2 && preview && (
          <>
            <div className="stat-grid">
              <div className="stat"><div className="v">{fa(preview.feature_count)}</div><div className="k">تعداد عارضه</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 16 }}>{GEOM_LABEL[preview.geom_type] || preview.geom_type}</div><div className="k">نوع هندسه</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 16 }}>{preview.source_srid ? `EPSG:${preview.source_srid}` : "نامشخص"}</div><div className="k">سیستم تصویر</div></div>
              <div className="stat"><div className="v" style={{ fontSize: 16 }}>{preview.encoding}</div><div className="k">رمزگذاری</div></div>
            </div>

            <div className="row">
              <div className="field grow">
                <label>درون‌ریزی در</label>
                <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">لایه جدید</option>
                  {layers.map((l) => <option key={l.id} value={l.id}>افزودن به لایه موجود: {l.name}</option>)}
                </select>
              </div>
              {!target && (
                <div className="field grow">
                  <label>نام لایه جدید</label>
                  <input className="input" value={layerName} onChange={(e) => setLayerName(e.target.value)} />
                </div>
              )}
              <div className="field" style={{ width: 150 }}>
                <label>کد EPSG مبدأ</label>
                <input className="input ltr" value={srid} onChange={(e) => setSrid(e.target.value)} placeholder="4326 / 32639" />
              </div>
            </div>
            {!preview.source_srid && (
              <div className="alert alert-warn">فایل prj یافت نشد. کد EPSG را وارد کنید (WGS84 = 4326، UTM 39N = 32639، UTM 38N = 32638).</div>
            )}

            <h4 style={{ margin: "8px 0" }}>ستون‌های شیپ‌فایل</h4>
            <div style={{ overflowX: "auto" }}>
              <table className="grid">
                <thead>
                  <tr><th>درون‌ریزی</th><th>نام ستون</th><th>نوع</th><th>ستون برچسب</th><th>نمونه مقادیر</th></tr>
                </thead>
                <tbody>
                  {preview.fields.map((f) => (
                    <tr key={f.source_name}>
                      <td><input type="checkbox" checked={!skip.has(f.source_name)} onChange={() => toggleSkip(f.source_name)} /></td>
                      <td><strong>{f.source_name}</strong></td>
                      <td>{TYPE_LABEL[f.data_type]}</td>
                      <td><input type="radio" name="labelf" checked={labelField === f.source_name} onChange={() => setLabelField(f.source_name)} /></td>
                      <td className="muted tiny">
                        {preview.sample.map((s) => cellText(s.attributes[f.key])).filter(Boolean).slice(0, 3).join(" | ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={doImport} disabled={busy}>
                {busy ? <><span className="spinner" /> در حال درون‌ریزی…</> : `درون‌ریزی ${fa(preview.feature_count)} عارضه`}
              </button>
              <button className="btn" onClick={reset} disabled={busy}>بازگشت</button>
            </div>
          </>
        )}

        {step === 3 && result && (
          <>
            <div className="alert alert-success">✔ {result.detail}</div>
            {result.new_fields.length > 0 && (
              <p className="tiny muted">ستون‌های ساخته‌شده: {result.new_fields.join("، ")}</p>
            )}
            <div className="row">
              <button className="btn btn-primary" onClick={() => onImported(result.layer_id)}>مشاهده روی نقشه</button>
              <button className="btn" onClick={reset}>آپلود فایل دیگر</button>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ maxWidth: 980, margin: "0 auto" }}>
        <h3>🕘 سابقه درون‌ریزی‌ها</h3>
        {jobs.length === 0 ? (
          <div className="muted tiny">سابقه‌ای ثبت نشده است.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="grid">
              <thead><tr><th>تاریخ</th><th>فایل</th><th>لایه</th><th>تعداد</th><th>کاربر</th><th>وضعیت</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="tiny">{shamsi(j.created_at)}</td>
                    <td>{j.filename}</td>
                    <td>{j.layer_name || "—"}</td>
                    <td>{fa(j.feature_count)}</td>
                    <td>{j.user || "—"}</td>
                    <td title={j.error || ""}>
                      <span className={`badge ${j.status === "success" ? "badge-success" : "badge-danger"}`}>
                        {j.status === "success" ? "موفق" : "ناموفق"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

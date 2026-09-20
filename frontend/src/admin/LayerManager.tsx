// ---- مدیریت لایه‌ها و ستون‌های جدول توصیفی (Add Field مشابه ArcGIS) ----
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { FieldDef, FieldType, GeomType, Layer } from "../types";
import {
  Confirm, Empty, ErrorBox, GEOM_LABEL, Loading, Modal, TYPE_LABEL, fa, shamsi, useToast,
} from "../ui";

export default function LayerManager({
  isAdmin, onChanged,
}: {
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNewLayer, setShowNewLayer] = useState(false);
  const [showNewField, setShowNewField] = useState(false);
  const [editField, setEditField] = useState<FieldDef | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; msg: string; danger?: boolean; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  const loadLayers = useCallback(async () => {
    try {
      const ls = await api.layers(true);
      setLayers(ls);
      setSelected((cur) => cur ?? ls[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadFields = useCallback(async (id: string) => {
    try {
      setFields(await api.fields(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { loadLayers(); }, [loadLayers]);
  useEffect(() => { if (selected) loadFields(selected); }, [selected, loadFields]);

  const layer = layers?.find((l) => l.id === selected);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const refreshAll = async () => {
    await loadLayers();
    if (selected) await loadFields(selected);
    onChanged();
  };

  const moveField = async (f: FieldDef, dir: -1 | 1) => {
    const idx = fields.findIndex((x) => x.id === f.id);
    const other = fields[idx + dir];
    if (!other || !selected) return;
    try {
      await api.updateField(selected, f.id, { sort_order: other.sort_order });
      await api.updateField(selected, other.id, { sort_order: f.sort_order });
      await loadFields(selected);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (!layers) return <Loading />;

  return (
    <div style={{ display: "flex", gap: 14, padding: 14, height: "100%", overflow: "auto", flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* فهرست لایه‌ها */}
      <div className="card" style={{ flex: "0 0 300px", maxWidth: "100%" }}>
        <h3 style={{ justifyContent: "space-between" }}>
          <span>🗂 لایه‌ها</span>
          <button className="btn btn-sm btn-primary" onClick={() => setShowNewLayer(true)}>＋ لایه جدید</button>
        </h3>
        <ErrorBox msg={error} />
        {layers.length === 0 && <Empty text="لایه‌ای وجود ندارد. شیپ‌فایل آپلود کنید یا لایه بسازید." />}
        {layers.map((l) => (
          <div
            key={l.id}
            onClick={() => setSelected(l.id)}
            style={{
              padding: "8px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 4,
              background: l.id === selected ? "var(--primary-soft)" : "transparent",
              border: `1px solid ${l.id === selected ? "#c7dbfe" : "transparent"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <strong style={{ opacity: l.is_archived ? 0.5 : 1 }}>{l.name}</strong>
              {l.is_archived && <span className="badge badge-warn">آرشیو</span>}
            </div>
            <div className="tiny muted">
              {GEOM_LABEL[l.geom_type]} · {fa(l.feature_count)} عارضه
              {!l.is_visible_public && " · غیرعمومی"}
            </div>
          </div>
        ))}
      </div>

      {/* جزئیات لایه و ستون‌ها */}
      {layer && (
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          <LayerSettings key={layer.id} layer={layer} fields={fields} onSaved={refreshAll} />

          <div className="card">
            <h3 style={{ justifyContent: "space-between" }}>
              <span>📋 ستون‌های جدول توصیفی ({fa(fields.length)})</span>
              <button className="btn btn-sm btn-primary" onClick={() => setShowNewField(true)} disabled={layer.is_archived}>
                ＋ افزودن ستون جدید
              </button>
            </h3>
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              ستون جدید برای همه {fa(layer.feature_count)} عارضه این لایه اضافه می‌شود.
            </div>
            {fields.length === 0 ? (
              <Empty text="ستونی تعریف نشده است." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>ترتیب</th>
                      <th>عنوان</th>
                      <th>شناسه فنی</th>
                      <th>نوع</th>
                      <th>اجباری</th>
                      <th>جست‌وجو</th>
                      <th>پیش‌فرض</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => (
                      <tr key={f.id}>
                        <td className="nowrap">
                          <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => moveField(f, -1)} title="بالا">▲</button>
                          <button className="btn btn-sm btn-ghost" disabled={i === fields.length - 1} onClick={() => moveField(f, 1)} title="پایین">▼</button>
                        </td>
                        <td><strong>{f.label}</strong>{f.unit && <span className="muted tiny"> ({f.unit})</span>}</td>
                        <td className="mono">{f.key}</td>
                        <td>
                          {TYPE_LABEL[f.data_type]}
                          {f.data_type === "select" && <div className="tiny muted">{f.options.join("، ")}</div>}
                        </td>
                        <td>{f.is_required ? "✔" : ""}</td>
                        <td>{f.is_searchable ? "✔" : ""}</td>
                        <td>{f.default_value || <span className="cell-empty">—</span>}</td>
                        <td className="nowrap">
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditField(f)} title="ویرایش">✏</button>
                          {isAdmin && !f.is_system && (
                            <button
                              className="btn btn-sm btn-ghost"
                              title="حذف ستون"
                              onClick={() =>
                                setConfirm({
                                  title: "حذف ستون",
                                  msg: `ستون «${f.label}» و مقادیر آن در همه عوارض حذف می‌شود. این عمل برگشت‌پذیر نیست.`,
                                  danger: true,
                                  run: async () => {
                                    const r = await api.deleteField(layer.id, f.id);
                                    toast(`${r.detail} (${fa(r.values_removed)} مقدار پاک شد)`, "ok");
                                    await refreshAll();
                                  },
                                })
                              }
                            >
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="card">
              <h3>🛠 عملیات لایه</h3>
              <div className="tiny muted" style={{ marginBottom: 8 }}>ایجاد: {shamsi(layer.created_at)}</div>
              <div className="row">
                {layer.is_archived ? (
                  <button
                    className="btn"
                    onClick={() =>
                      setConfirm({
                        title: "بازگردانی لایه",
                        msg: `لایه «${layer.name}» از آرشیو خارج و دوباره نمایش داده می‌شود.`,
                        run: async () => {
                          toast((await api.restoreLayer(layer.id)).detail, "ok");
                          await refreshAll();
                        },
                      })
                    }
                  >
                    ♻ بازگردانی از آرشیو
                  </button>
                ) : (
                  <button
                    className="btn"
                    onClick={() =>
                      setConfirm({
                        title: "آرشیو لایه",
                        msg: `لایه «${layer.name}» آرشیو می‌شود: از دید عموم پنهان و غیرقابل ویرایش خواهد شد، اما داده‌ها حفظ می‌شوند.`,
                        run: async () => {
                          toast((await api.archiveLayer(layer.id)).detail, "ok");
                          await refreshAll();
                        },
                      })
                    }
                  >
                    📦 آرشیو کردن لایه
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() =>
                    setConfirm({
                      title: "حذف کامل لایه",
                      msg: `لایه «${layer.name}» با ${fa(layer.feature_count)} عارضه و تمام تاریخچه آن برای همیشه حذف می‌شود. پیشنهاد می‌شود به جای حذف، آرشیو کنید.`,
                      danger: true,
                      run: async () => {
                        toast((await api.deleteLayer(layer.id)).detail, "ok");
                        setSelected(null);
                        await loadLayers();
                        onChanged();
                      },
                    })
                  }
                >
                  🗑 حذف کامل
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showNewLayer && (
        <NewLayerModal
          onClose={() => setShowNewLayer(false)}
          onCreated={async (l) => {
            setShowNewLayer(false);
            toast(`لایه «${l.name}» ساخته شد.`, "ok");
            setSelected(l.id);
            await loadLayers();
            onChanged();
          }}
        />
      )}
      {showNewField && layer && (
        <FieldModal
          layerId={layer.id}
          onClose={() => setShowNewField(false)}
          onSaved={async (f) => {
            setShowNewField(false);
            toast(`ستون «${f.label}» اضافه شد.`, "ok");
            await refreshAll();
          }}
        />
      )}
      {editField && layer && (
        <FieldModal
          layerId={layer.id}
          field={editField}
          onClose={() => setEditField(null)}
          onSaved={async () => {
            setEditField(null);
            toast("ستون ویرایش شد.", "ok");
            await refreshAll();
          }}
        />
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          message={confirm.msg}
          danger={confirm.danger}
          busy={busy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ---------------- تنظیمات لایه ----------------

function LayerSettings({ layer, fields, onSaved }: { layer: Layer; fields: FieldDef[]; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(layer.name);
  const [description, setDescription] = useState(layer.description);
  const [color, setColor] = useState(String((layer.style as { color?: string }).color || "#1d4ed8"));
  const [labelField, setLabelField] = useState(layer.label_field || "");
  const [isPublic, setIsPublic] = useState(layer.is_visible_public);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateLayer(layer.id, {
        name, description, label_field: labelField || null,
        is_visible_public: isPublic, style: { ...layer.style, color },
      });
      toast("تنظیمات لایه ذخیره شد.", "ok");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>⚙ تنظیمات لایه «{layer.name}»</h3>
      <div className="row">
        <div className="field grow">
          <label>نام لایه</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>رنگ</label>
          <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 2, height: 36 }} />
        </div>
        <div className="field grow">
          <label>ستون برچسب (نام نمایشی عارضه)</label>
          <select className="select" value={labelField} onChange={(e) => setLabelField(e.target.value)}>
            <option value="">— خودکار —</option>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>توضیحات</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <label className="checkbox">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          نمایش برای کاربران عمومی (بدون ورود)
        </label>
        <button className="btn btn-primary" onClick={save} disabled={busy}>ذخیره تنظیمات</button>
      </div>
    </div>
  );
}

// ---------------- لایه جدید ----------------

function NewLayerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (l: Layer) => void }) {
  const [name, setName] = useState("");
  const [geom, setGeom] = useState<GeomType>("linestring");
  const [color, setColor] = useState("#dc2626");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const l = await api.createLayer({ name, geom_type: geom, style: { color } });
      // یک ستون «نام» پیش‌فرض برای شروع کار
      await api.createField(l.id, { key: "name", label: "نام", data_type: "text" });
      await api.updateLayer(l.id, { label_field: "name" });
      onCreated(l);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="ایجاد لایه جدید"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>ایجاد لایه</button>
          <button className="btn" onClick={onClose}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      <div className="field">
        <label>نام لایه<span className="req">*</span></label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: نقاط شاخص شهری" autoFocus />
      </div>
      <div className="row">
        <div className="field grow">
          <label>نوع هندسه</label>
          <select className="select" value={geom} onChange={(e) => setGeom(e.target.value as GeomType)}>
            {(["point", "linestring", "polygon", "mixed"] as GeomType[]).map((g) => (
              <option key={g} value={g}>{GEOM_LABEL[g]}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>رنگ</label>
          <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 2, height: 36 }} />
        </div>
      </div>
      <div className="tiny muted">یک ستون «نام» به صورت خودکار ساخته می‌شود؛ ستون‌های دیگر را پس از ایجاد اضافه کنید.</div>
    </Modal>
  );
}

// ---------------- افزودن/ویرایش ستون ----------------

function FieldModal({
  layerId, field, onClose, onSaved,
}: {
  layerId: string;
  field?: FieldDef;
  onClose: () => void;
  onSaved: (f: FieldDef) => void;
}) {
  const editing = Boolean(field);
  const [label, setLabel] = useState(field?.label || "");
  const [key, setKey] = useState(field?.key || "");
  const [type, setType] = useState<FieldType>(field?.data_type || "text");
  const [options, setOptions] = useState((field?.options || []).join("\n"));
  const [required, setRequired] = useState(field?.is_required || false);
  const [searchable, setSearchable] = useState(field?.is_searchable ?? true);
  const [def, setDef] = useState(field?.default_value || "");
  const [unit, setUnit] = useState(field?.unit || "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setError("شناسه فنی فقط می‌تواند شامل حروف لاتین، رقم و _ باشد و با رقم شروع نشود.");
      return;
    }
    const opts = options.split("\n").map((s) => s.trim()).filter(Boolean);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        label, options: opts, is_required: required, is_searchable: searchable,
        default_value: def || null, unit: unit || null,
      };
      const f = editing
        ? await api.updateField(layerId, field!.id, body)
        : await api.createField(layerId, { ...body, key: key || null, data_type: type });
      onSaved(f);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `ویرایش ستون «${field!.label}»` : "افزودن ستون جدید به جدول توصیفی"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !label.trim()}>
            {busy ? <span className="spinner" /> : editing ? "ذخیره" : "افزودن ستون"}
          </button>
          <button className="btn" onClick={onClose}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      <div className="row">
        <div className="field grow">
          <label>عنوان ستون (فارسی)<span className="req">*</span></label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً: عرض معبر" autoFocus />
        </div>
        <div className="field grow">
          <label>شناسه فنی (اختیاری، لاتین)</label>
          <input className="input ltr" value={key} onChange={(e) => setKey(e.target.value)} disabled={editing} placeholder="width" />
        </div>
      </div>
      <div className="row">
        <div className="field grow">
          <label>نوع داده</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as FieldType)} disabled={editing}>
            {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label>واحد (اختیاری)</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="متر" />
        </div>
      </div>
      {type === "select" && (
        <div className="field">
          <label>گزینه‌ها (هر گزینه در یک سطر)<span className="req">*</span></label>
          <textarea className="textarea" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} placeholder={"آسفالت\nموزاییک\nخاکی"} />
        </div>
      )}
      <div className="field">
        <label>مقدار پیش‌فرض {!editing && "(روی همه عوارض موجود نوشته می‌شود)"}</label>
        <input className="input" value={def} onChange={(e) => setDef(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 18 }}>
        <label className="checkbox">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> اجباری
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} /> قابل جست‌وجو
        </label>
      </div>
      {editing && <div className="tiny muted" style={{ marginTop: 8 }}>نوع داده و شناسه فنی پس از ایجاد قابل تغییر نیستند.</div>}
    </Modal>
  );
}

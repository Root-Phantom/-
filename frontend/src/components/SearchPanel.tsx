// ---- جست‌وجوی حرفه‌ای در جدول توصیفی (ساخت پرس‌وجوی چندشرطی) ----
import { useEffect, useState } from "react";

import { api } from "../api";
import type { Operator, OperatorInfo, SearchCondition, SearchField } from "../types";
import { TYPE_LABEL, fa } from "../ui";

const NO_VALUE_OPS: Operator[] = ["is_empty", "is_not_empty"];
const TWO_VALUE_OPS: Operator[] = ["between"];

export interface SearchPanelProps {
  layerId: string | null;
  fields: SearchField[];
  operators: OperatorInfo[];
  q: string;
  conditions: SearchCondition[];
  logic: "and" | "or";
  includeArchived: boolean;
  canSeeArchive: boolean;
  total: number;
  hasSpatial: boolean;
  onQ: (v: string) => void;
  onConditions: (c: SearchCondition[]) => void;
  onLogic: (l: "and" | "or") => void;
  onIncludeArchived: (v: boolean) => void;
  onRun: () => void;
  onReset: () => void;
  onExportCsv: () => void;
  onExportGeojson: () => void;
}

export default function SearchPanel(p: SearchPanelProps) {
  const {
    layerId, fields, operators, q, conditions, logic, includeArchived, canSeeArchive,
    total, hasSpatial, onQ, onConditions, onLogic, onIncludeArchived, onRun, onReset,
    onExportCsv, onExportGeojson,
  } = p;

  // مقادیر یکتای هر ستون برای کمک به کاربر
  const [distinct, setDistinct] = useState<Record<string, { value: string; count: number }[]>>({});

  const typeOf = (key: string) => fields.find((f) => f.key === key)?.data_type || "text";

  const opsFor = (key: string) => {
    const t = typeOf(key);
    return operators.filter((o) => o.types.includes(t));
  };

  const addCondition = () => {
    const first = fields[0];
    if (!first) return;
    onConditions([...conditions, { field: first.key, op: "contains", value: "" }]);
  };

  const update = (i: number, patch: Partial<SearchCondition>) => {
    const next = conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onConditions(next);
  };

  const remove = (i: number) => onConditions(conditions.filter((_, idx) => idx !== i));

  // وقتی ستون تغییر کرد، عملگر را به یک عملگر معتبر برای آن نوع تبدیل کن
  const changeField = (i: number, key: string) => {
    const valid = opsFor(key);
    const current = conditions[i].op;
    const op = valid.some((o) => o.value === current) ? current : (valid[0]?.value ?? "contains");
    update(i, { field: key, op, value: "", value2: "" });
  };

  // بارگیری مقادیر یکتا برای ستون‌های متنی انتخاب‌شده
  useEffect(() => {
    if (!layerId) return;
    const keys = conditions
      .map((c) => c.field)
      .filter((k) => !k.startsWith("__") && !distinct[k] && ["text", "select"].includes(typeOf(k)));
    const unique = Array.from(new Set(keys));
    if (unique.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const k of unique) {
        try {
          const vals = await api.distinct(layerId, k);
          if (!cancelled) setDistinct((prev) => ({ ...prev, [k]: vals }));
        } catch {
          /* نادیده */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions.map((c) => c.field).join(","), layerId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onRun();
  };

  return (
    <>
      <div className="card">
        <h3>🔎 جست‌وجوی سریع</h3>
        <div className="field">
          <input
            className="input"
            placeholder="نام معبر، شماره پلاک، هر واژه…"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            در همه ستون‌های قابل جست‌وجو گشته می‌شود. تفاوت «ی/ي» و «ک/ك» نادیده گرفته می‌شود.
          </div>
        </div>
      </div>

      <div className="card">
        <h3>⚙ جست‌وجوی پیشرفته</h3>

        {conditions.length > 1 && (
          <div className="field">
            <label>ترکیب شرط‌ها</label>
            <div className="logic-toggle">
              <button className={logic === "and" ? "active" : ""} onClick={() => onLogic("and")}>
                همه شرط‌ها (و)
              </button>
              <button className={logic === "or" ? "active" : ""} onClick={() => onLogic("or")}>
                یکی از شرط‌ها (یا)
              </button>
            </div>
          </div>
        )}

        {conditions.map((c, i) => {
          const needsTwo = TWO_VALUE_OPS.includes(c.op);
          const needsNone = NO_VALUE_OPS.includes(c.op);
          const t = typeOf(c.field);
          const opts = distinct[c.field];
          const listId = `dl-${i}-${c.field}`;
          const fieldDef = fields.find((f) => f.key === c.field);

          return (
            <div key={i} className={`cond-row ${needsTwo ? "with-second" : ""}`}>
              <select className="select" value={c.field} onChange={(e) => changeField(i, e.target.value)}>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                className="select"
                value={c.op}
                onChange={(e) => update(i, { op: e.target.value as Operator, value: "", value2: "" })}
              >
                {opsFor(c.field).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {!needsNone && (
                <>
                  {t === "select" && fieldDef?.options.length ? (
                    <select
                      className="select"
                      value={String(c.value ?? "")}
                      onChange={(e) => update(i, { value: e.target.value })}
                    >
                      <option value="">— انتخاب کنید —</option>
                      {fieldDef.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        className={`input ${t === "number" || t === "integer" || t === "date" ? "ltr" : ""}`}
                        type={t === "date" ? "date" : t === "number" || t === "integer" ? "number" : "text"}
                        value={String(c.value ?? "")}
                        onChange={(e) => update(i, { value: e.target.value })}
                        onKeyDown={onKey}
                        placeholder={needsTwo ? "از" : "مقدار"}
                        list={opts ? listId : undefined}
                      />
                      {opts && (
                        <datalist id={listId}>
                          {opts.slice(0, 200).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.value} ({o.count})
                            </option>
                          ))}
                        </datalist>
                      )}
                    </>
                  )}
                  {needsTwo && (
                    <input
                      className="input ltr"
                      type={t === "date" ? "date" : "number"}
                      value={String(c.value2 ?? "")}
                      onChange={(e) => update(i, { value2: e.target.value })}
                      onKeyDown={onKey}
                      placeholder="تا"
                    />
                  )}
                </>
              )}

              <button className="btn btn-sm btn-ghost" onClick={() => remove(i)} title="حذف شرط">
                ✕
              </button>
            </div>
          );
        })}

        <button className="btn btn-sm btn-block" onClick={addCondition} disabled={fields.length === 0}>
          ＋ افزودن شرط
        </button>

        {canSeeArchive && (
          <label className="checkbox" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => onIncludeArchived(e.target.checked)}
            />
            نمایش عوارض آرشیوشده
          </label>
        )}

        {hasSpatial && (
          <div className="alert alert-warn tiny" style={{ marginTop: 10, marginBottom: 0 }}>
            🔍 فیلتر مکانی فعال است — فقط عوارض داخل محدوده ترسیمی نمایش داده می‌شوند.
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary grow" onClick={onRun}>
            اجرای جست‌وجو
          </button>
          <button className="btn" onClick={onReset} title="پاک‌کردن همه شرط‌ها">
            پاک‌کردن
          </button>
        </div>

        <div className="tiny muted" style={{ marginTop: 8 }}>
          نتیجه: <strong>{fa(total)}</strong> عارضه
        </div>
      </div>

      <div className="card">
        <h3>📤 خروجی جدول توصیفی</h3>
        <div className="row">
          <button className="btn btn-sm grow" onClick={onExportCsv} disabled={!layerId}>
            CSV (اکسل)
          </button>
          <button className="btn btn-sm grow" onClick={onExportGeojson} disabled={!layerId}>
            GeoJSON
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          خروجی بر اساس همان شرط‌های جست‌وجوی جاری ساخته می‌شود. فایل GeoJSON در ArcGIS و QGIS باز می‌شود.
        </div>
      </div>

      {fields.length > 0 && (
        <div className="card">
          <h3>📋 ستون‌های این لایه</h3>
          <div className="tiny">
            {fields
              .filter((f) => !f.key.startsWith("__"))
              .map((f) => (
                <div
                  key={f.key}
                  style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}
                >
                  <span>{f.label}</span>
                  <span className="muted">{TYPE_LABEL[f.data_type] || f.data_type}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---- جدول توصیفی: مشابه Attribute Table در ArcGIS ----
import { useMemo } from "react";

import type { Feature, FieldDef } from "../types";
import { Empty, Loading, Pager, cellText, fa, shamsi } from "../ui";

export interface AttributeTableProps {
  features: Feature[];
  fields: FieldDef[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  selectedId: string | null;
  selectedIds: Set<string>;
  sortBy: string | null;
  sortDir: "asc" | "desc";
  canEdit: boolean;
  canSuggest: boolean;
  /** کاربر واردشده: مشاهده تاریخچه و نام ویرایش‌کننده */
  isStaff: boolean;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  onSort: (key: string) => void;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string) => void;
  onHistory: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onSuggest: (id: string) => void;
}

export default function AttributeTable(p: AttributeTableProps) {
  const {
    features, fields, total, page, pageSize, loading, selectedId, selectedIds,
    sortBy, sortDir, canEdit, canSuggest, isStaff, onPage, onPageSize, onSort, onSelect,
    onToggleCheck, onToggleAll, onEdit, onHistory, onArchive, onRestore, onSuggest,
  } = p;

  const allChecked = useMemo(
    () => features.length > 0 && features.every((f) => selectedIds.has(f.id)),
    [features, selectedIds],
  );

  const sortIcon = (key: string) => {
    if (sortBy !== key) return <span className="muted tiny"> ⇅</span>;
    return <span className="tiny"> {sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  if (loading && features.length === 0) return <Loading text="در حال خواندن جدول توصیفی…" />;

  return (
    <>
      <div className="table-wrap">
        {features.length === 0 ? (
          <Empty icon="🔍" text="عارضه‌ای یافت نشد. شرط‌های جست‌وجو را تغییر دهید." />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                {canEdit && (
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={onToggleAll}
                      title="انتخاب همه ردیف‌های این صفحه"
                      style={{ accentColor: "var(--primary)", cursor: "pointer" }}
                    />
                  </th>
                )}
                <th style={{ width: 48 }}>ردیف</th>
                {fields.map((f) => (
                  <th
                    key={f.key}
                    className="sortable"
                    onClick={() => onSort(f.key)}
                    title={`مرتب‌سازی بر اساس ${f.label}`}
                  >
                    {f.label}
                    {f.unit ? <span className="muted tiny"> ({f.unit})</span> : null}
                    {sortIcon(f.key)}
                  </th>
                ))}
                <th className="sortable" onClick={() => onSort("__updated_at")}>
                  آخرین ویرایش{sortIcon("__updated_at")}
                </th>
                {isStaff && <th>ویرایش‌کننده</th>}
                <th style={{ width: 150 }}>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr
                  key={f.id}
                  className={[
                    f.id === selectedId ? "selected" : "",
                    f.is_archived ? "archived" : "",
                  ].join(" ")}
                  onClick={() => onSelect(f.id)}
                  style={{ cursor: "pointer" }}
                >
                  {canEdit && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(f.id)}
                        onChange={() => onToggleCheck(f.id)}
                        style={{ accentColor: "var(--primary)", cursor: "pointer" }}
                      />
                    </td>
                  )}
                  <td className="muted">{fa((page - 1) * pageSize + i + 1)}</td>
                  {fields.map((fd) => {
                    const v = cellText(f.attributes[fd.key]);
                    return (
                      <td key={fd.key} title={v}>
                        {v || <span className="cell-empty">—</span>}
                      </td>
                    );
                  })}
                  <td className="muted tiny nowrap">{shamsi(f.updated_at)}</td>
                  {isStaff && <td className="muted tiny">{f.updated_by_name || "—"}</td>}
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <button className="btn btn-sm btn-ghost" onClick={() => onEdit(f.id)} title="ویرایش جدول توصیفی">
                        ✏
                      </button>
                    )}
                    {isStaff && (
                      <button className="btn btn-sm btn-ghost" onClick={() => onHistory(f.id)} title="تاریخچه تغییرات">
                        🕘
                      </button>
                    )}
                    {canSuggest && !canEdit && (
                      <button className="btn btn-sm btn-ghost" onClick={() => onSuggest(f.id)} title="پیشنهاد نام">
                        💡
                      </button>
                    )}
                    {canEdit &&
                      (f.is_archived ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => onRestore(f.id)} title="بازگردانی از آرشیو">
                          ♻
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => onArchive(f.id)} title="آرشیو کردن">
                          📦
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="table-footer">
        {loading && <span className="spinner" />}
        <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
        <select
          className="select"
          style={{ width: 105 }}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          title="تعداد ردیف در هر صفحه"
        >
          {[25, 50, 100, 250, 500].map((n) => (
            <option key={n} value={n}>
              {n} ردیف
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

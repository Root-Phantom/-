// ---- اجزای کوچک مشترک رابط کاربری ----
import React, { createContext, useCallback, useContext, useState } from "react";

// ---------- پنجره (مودال) ----------

export function Modal({
  title, subtitle, onClose, children, footer, size = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "" | "wide" | "xwide";
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="x-btn" onClick={onClose} aria-label="بستن" title="بستن">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- پیام‌های شناور ----------

type Toast = { id: number; text: string; kind: "ok" | "err" | "" };

const ToastCtx = createContext<(text: string, kind?: "ok" | "err" | "") => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((text: string, kind: "ok" | "err" | "" = "") => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { id, text, kind }]);
    window.setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- بارگذاری / خالی ----------

export const Loading = ({ text = "در حال بارگذاری…" }: { text?: string }) => (
  <div className="loading-box">
    <span className="spinner" /> {text}
  </div>
);

export const Empty = ({ icon = "📭", text }: { icon?: string; text: string }) => (
  <div className="empty">
    <span className="icon">{icon}</span>
    {text}
  </div>
);

export const ErrorBox = ({ msg }: { msg: string | null }) =>
  msg ? <div className="alert alert-error">⚠ {msg}</div> : null;

// ---------- تأیید عملیات ----------

export function Confirm({
  title, message, confirmLabel = "تأیید", danger = false, onConfirm, onCancel, busy = false,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy}>
            انصراف
          </button>
        </>
      }
    >
      {message}
    </Modal>
  );
}

// ---------- صفحه‌بندی ----------

export function Pager({
  page, pageSize, total, onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <>
      <span className="nowrap">
        نمایش {fa(from)}–{fa(to)} از {fa(total)}
      </span>
      <div className="spacer" style={{ flex: 1 }} />
      <div className="pager">
        <button className="btn btn-sm" onClick={() => onPage(1)} disabled={page <= 1} title="نخست">
          «
        </button>
        <button className="btn btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          قبلی
        </button>
        <span className="nowrap" style={{ padding: "0 6px" }}>
          صفحه {fa(page)} از {fa(pages)}
        </span>
        <button className="btn btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          بعدی
        </button>
        <button className="btn btn-sm" onClick={() => onPage(pages)} disabled={page >= pages} title="آخر">
          »
        </button>
      </div>
    </>
  );
}

// ---------- ابزارهای قالب‌بندی ----------

/** عدد را با جداکننده هزارگان فارسی نمایش می‌دهد. */
export function fa(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString("fa-IR", { maximumFractionDigits: 4 });
}

/** تاریخ و زمان میلادی ISO را به تاریخ شمسی خوانا تبدیل می‌کند. */
export function shamsi(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("fa-IR-u-ca-persian", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

/** مقدار یک خانه جدول را برای نمایش آماده می‌کند. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  if (typeof v === "number") return fa(v);
  return String(v);
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "مدیر کل",
  editor: "کارشناس",
  viewer: "مشاهده‌کننده",
  public: "کاربر عمومی",
};

export const TYPE_LABEL: Record<string, string> = {
  text: "متن",
  number: "عدد",
  integer: "عدد صحیح",
  boolean: "بله/خیر",
  date: "تاریخ",
  select: "فهرست بازشو",
};

export const GEOM_LABEL: Record<string, string> = {
  point: "نقطه",
  linestring: "خط / معبر",
  polygon: "چندضلعی / محدوده",
  mixed: "ترکیبی",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
};

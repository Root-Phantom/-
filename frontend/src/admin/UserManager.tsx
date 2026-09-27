// ---- تعریف کاربران و تعیین سطح دسترسی ----
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { Role, User } from "../types";
import { Confirm, ErrorBox, Loading, Modal, Pager, ROLE_LABEL, shamsi, useToast } from "../ui";

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [items, setItems] = useState<User[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<{ value: string; label: string; description: string }[]>([]);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [toDelete, setToDelete] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.users({ q, role, page, page_size: 25 });
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, role, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.roles().then(setRoles).catch(() => {}); }, []);

  const toggleActive = async (u: User) => {
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      toast(u.is_active ? "کاربر غیرفعال شد." : "کاربر فعال شد.", "ok");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="input grow" placeholder="جست‌وجوی نام یا نام کاربری…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 320 }} />
          <select className="select" style={{ width: 170 }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">همه سطوح دسترسی</option>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div className="grow" />
          <button className="btn btn-primary" onClick={() => setEditing("new")}>＋ تعریف کاربر جدید</button>
        </div>
        <ErrorBox msg={error} />
        {!items ? <Loading /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="grid stack-mobile">
              <thead>
                <tr><th>نام کاربری</th><th>نام کامل</th><th>سطح دسترسی</th><th>تلفن</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td data-label="نام کاربری" className="mono">{u.username}</td>
                    <td data-label="نام کامل">{u.full_name}{u.id === currentUserId && <span className="badge badge-primary" style={{ marginInlineStart: 6 }}>شما</span>}</td>
                    <td data-label="سطح دسترسی"><span className={`badge ${u.role === "admin" ? "badge-danger" : u.role === "editor" ? "badge-primary" : "badge-muted"}`}>{ROLE_LABEL[u.role]}</span></td>
                    <td data-label="تلفن" className="mono">{u.phone || "—"}</td>
                    <td data-label="وضعیت"><span className={`badge ${u.is_active ? "badge-success" : "badge-muted"}`}>{u.is_active ? "فعال" : "غیرفعال"}</span></td>
                    <td data-label="آخرین ورود" className="tiny">{shamsi(u.last_login_at)}</td>
                    <td data-label="عملیات" className="nowrap">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)} title="ویرایش">✏</button>
                      {u.id !== currentUserId && (
                        <>
                          <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(u)} title={u.is_active ? "غیرفعال کردن" : "فعال کردن"}>
                            {u.is_active ? "⏸" : "▶"}
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setToDelete(u)} title="حذف">🗑</button>
                        </>
                      )}
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

      <div className="card">
        <h3>🔐 سطوح دسترسی</h3>
        {roles.map((r) => (
          <div key={r.value} style={{ marginBottom: 4 }}><strong>{r.label}:</strong> <span className="muted">{r.description}</span></div>
        ))}
        <div><strong>کاربر عمومی (بدون ورود):</strong> <span className="muted">مشاهده نقشه و جدول توصیفی، جست‌وجو و پیشنهاد نام معابر</span></div>
      </div>

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          roles={roles}
          isSelf={editing !== "new" && editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast("اطلاعات کاربر ذخیره شد.", "ok"); load(); }}
        />
      )}
      {toDelete && (
        <Confirm
          title="حذف کاربر"
          danger
          message={`کاربر «${toDelete.username}» حذف می‌شود. سوابق لاگ او با نام کاربری حفظ می‌شود. پیشنهاد: به جای حذف، کاربر را غیرفعال کنید.`}
          confirmLabel="حذف"
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              toast((await api.deleteUser(toDelete.id)).detail, "ok");
              load();
            } catch (e) {
              toast((e as Error).message, "err");
            }
            setToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function UserModal({
  user, roles, isSelf, onClose, onSaved,
}: {
  user: User | null;
  roles: { value: string; label: string }[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(user?.username || "");
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [role, setRole] = useState<Role>(user?.role || "editor");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (user) {
        const body: Record<string, unknown> = { full_name: fullName, email, phone };
        if (!isSelf) { body.role = role; body.is_active = active; }
        if (password) body.password = password;
        await api.updateUser(user.id, body);
      } else {
        await api.createUser({ username, password, full_name: fullName, email: email || null, phone: phone || null, role, is_active: active });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? `ویرایش کاربر «${user.username}»` : "تعریف کاربر جدید"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy || (!user && (!username || !password))}>
            {busy ? <span className="spinner" /> : "ذخیره"}
          </button>
          <button className="btn" onClick={onClose}>انصراف</button>
        </>
      }
    >
      <ErrorBox msg={error} />
      <div className="row">
        <div className="field grow">
          <label>نام کاربری (لاتین)<span className="req">*</span></label>
          <input className="input ltr" value={username} onChange={(e) => setUsername(e.target.value)} disabled={Boolean(user)} />
        </div>
        <div className="field grow">
          <label>نام و نام خانوادگی</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field grow">
          <label>تلفن</label>
          <input className="input ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field grow">
          <label>ایمیل</label>
          <input className="input ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field grow">
          <label>سطح دسترسی</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label>{user ? "بازنشانی گذرواژه (خالی = بدون تغییر)" : "گذرواژه اولیه"}{!user && <span className="req">*</span>}</label>
          <input className="input ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isSelf} /> حساب فعال است
      </label>
      <div className="tiny muted" style={{ marginTop: 8 }}>کاربر در نخستین ورود (یا پس از بازنشانی) به تغییر گذرواژه راهنمایی می‌شود.</div>
    </Modal>
  );
}

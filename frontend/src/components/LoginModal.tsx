// ---- ورود و تغییر گذرواژه ----
import { useState } from "react";

import { api } from "../api";
import { ErrorBox, Modal } from "../ui";

export function LoginModal({ onClose, onLoggedIn }: { onClose: () => void; onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(username, password);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="ورود کارکنان شهرداری" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox msg={error} />
        <div className="field">
          <label>نام کاربری</label>
          <input className="input ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>گذرواژه</label>
          <input className="input ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !username || !password}>
          {busy ? <span className="spinner" /> : "ورود"}
        </button>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          شهروندان برای مشاهده اطلاعات و پیشنهاد نام نیازی به ورود ندارند.
        </p>
      </form>
    </Modal>
  );
}

export function ChangePasswordModal({
  forced, onClose, onDone,
}: {
  forced: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (next !== repeat) {
      setError("گذرواژه جدید و تکرار آن یکسان نیستند.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="تغییر گذرواژه"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !current || !next}>
            {busy ? <span className="spinner" /> : "ذخیره گذرواژه"}
          </button>
          <button className="btn" onClick={onClose}>{forced ? "بعداً" : "انصراف"}</button>
        </>
      }
    >
      {forced && (
        <div className="alert alert-warn">برای امنیت حساب، لطفاً گذرواژه اولیه را تغییر دهید.</div>
      )}
      <ErrorBox msg={error} />
      <div className="field">
        <label>گذرواژه کنونی</label>
        <input className="input ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label>گذرواژه جدید (حداقل ۸ نویسه، شامل حرف و رقم)</label>
        <input className="input ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="field">
        <label>تکرار گذرواژه جدید</label>
        <input className="input ltr" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </div>
    </Modal>
  );
}

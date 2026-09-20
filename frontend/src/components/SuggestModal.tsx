// ---- پیشنهاد نام معبر توسط کاربر عمومی ----
import { useEffect, useState } from "react";

import { api } from "../api";
import { ErrorBox, Modal, fa } from "../ui";

export default function SuggestModal({
  featureId, currentName, onClose, onDone,
}: {
  featureId: string;
  currentName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<{ total: number; approved: number } | null>(null);

  useEffect(() => {
    api.publicSuggestionCount(featureId).then(setCount).catch(() => {});
  }, [featureId]);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError("نام پیشنهادی را وارد کنید.");
      return;
    }
    if (phone && !/^[0-9۰-۹+\-\s]{7,20}$/.test(phone)) {
      setError("شماره تماس معتبر نیست.");
      return;
    }
    setBusy(true);
    try {
      await api.createSuggestion({
        feature_id: featureId,
        suggested_name: name,
        reason: reason || null,
        submitter_name: submitter || null,
        submitter_phone: phone || null,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="پیشنهاد نام برای معبر"
      subtitle={`نام فعلی: ${currentName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : "ثبت پیشنهاد"}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>انصراف</button>
        </>
      }
    >
      <div className="alert alert-info tiny">
        پیشنهاد شما پس از بررسی کارشناسان شهرداری اعمال خواهد شد.
        {count && count.total > 0 && <> تاکنون {fa(count.total)} پیشنهاد برای این معبر ثبت شده است.</>}
      </div>
      <ErrorBox msg={error} />
      <div className="field">
        <label>نام پیشنهادی<span className="req">*</span></label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: کوچه شهید …" autoFocus />
      </div>
      <div className="field">
        <label>دلیل پیشنهاد</label>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row">
        <div className="field grow">
          <label>نام و نام خانوادگی (اختیاری)</label>
          <input className="input" value={submitter} onChange={(e) => setSubmitter(e.target.value)} />
        </div>
        <div className="field grow">
          <label>شماره تماس (اختیاری)</label>
          <input className="input ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

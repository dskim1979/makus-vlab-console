import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';

// Modal form: native <dialog>, Esc and Cancel close it, submit calls onSubmit.
export function Dialog({ open, title, onClose, onSubmit, submitLabel, busy, error, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit?.();
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <h2>{title}</h2>
        {children}
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          {onSubmit && (
            <button type="submit" className="btn primary" disabled={busy}>{submitLabel ?? t('common.save')}</button>
          )}
        </div>
      </form>
    </dialog>
  );
}

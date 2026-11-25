import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../state/AppStore';
import { enumLabel } from '../lib/labels';

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple';
  children: ReactNode;
}) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  const map: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple'> = {
    scheduled: 'blue',
    canceled: 'red',
    fulfilled: 'green',
    active: 'blue',
    in_review: 'amber',
    returned: 'amber',
    confirmed: 'green',
    draft: 'gray',
    submitted: 'amber',
    completed: 'green',
    partial: 'blue',
    incomplete: 'red',
    none: 'gray',
    pending_verification: 'purple',
    草稿: 'gray',
    已发出: 'blue',
    已退回补件: 'red',
    已接收回执: 'purple',
    已办结: 'green',
    provider_contact: 'blue',
    client_contact: 'blue',
    supplement_due: 'amber',
    done: 'green',
    open: 'amber',
    superseded: 'gray',
  };
  return <Badge tone={map[value] ?? 'gray'}>{enumLabel(value)}</Badge>;
}

export function ToastHost() {
  const { toasts } = useApp();
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** 供屏幕阅读器播报异步结果 */
export function LiveRegion() {
  const { liveMessage } = useApp();
  return (
    <div aria-live="assertive" role="status" className="visually-hidden">
      {liveMessage}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && panelRef.current) {
        // 简单焦点陷阱
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        style={width ? { width } : undefined}
      >
        <div className="modal-hd">
          {title}
          <button
            ref={closeRef}
            className="btn btn-ghost btn-sm"
            style={{ float: 'right' }}
            onClick={onClose}
            aria-label="关闭对话框"
          >
            ✕
          </button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card">
      <div className="card-bd" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ fontSize: 17, fontWeight: 700 }}>{title}</p>
        {hint && <p className="muted">{hint}</p>}
      </div>
    </div>
  );
}

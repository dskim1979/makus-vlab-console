import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Parts the admin tables share (VM, users, pools, nodes): a floating menu that the table's scroll box
// does not clip, the small usage bar, the pager, the caret, a plain modal.

export function Caret() {
  return <svg className="vt-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Usage({ main, pct }: { main: string; pct: number | null }) {
  const level = pct == null ? '' : pct >= 90 ? ' hot' : pct >= 70 ? ' warm' : '';
  return (
    <span className="vt-usage">
      <span className="vt-usage-main">{main}</span>
      <span className="vt-usage-bar"><span className={`vt-usage-fill${level}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></span>
      <span className="vt-usage-pct">{pct == null ? '-' : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`}</span>
    </span>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const list: (number | '…')[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== '…') list.push('…');
  }
  return (
    <nav className="vt-pages" aria-label="pages">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="previous">‹</button>
      {list.map((p, i) => p === '…' ? <span key={`e${i}`} className="muted">…</span>
        : <button key={p} type="button" className={p === page ? 'on' : ''} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p + 1}</button>)}
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="next">›</button>
    </nav>
  );
}

// A small menu that floats over the page (fixed), so the table's scroll box does not clip it.
export function Drop({ label, children, className, disabled, align = 'right' }: {
  label: ReactNode; children: (close: () => void) => ReactNode; className: string; disabled?: boolean; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setPos(null); }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = menu.current.offsetHeight; const w = menu.current.offsetWidth;
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    const left = align === 'left' ? r.left : r.right - w;
    setPos({ top: up ? r.top - h - 4 : r.bottom + 4, left: Math.max(8, Math.min(left, window.innerWidth - w - 8)) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (menu.current?.contains(t as Node) || btn.current?.contains(t as Node));
    const down = (e: MouseEvent) => { if (!inside(e.target)) close(); };
    const scroll = (e: Event) => { if (!inside(e.target)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <>
      <button ref={btn} type="button" className={className} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}>{label}</button>
      {open && createPortal(
        <div ref={menu} role="menu" className="menu vt-pop"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>
          {children(close)}
        </div>, document.body)}
    </>
  );
}

export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title}>
      <h2>{title}</h2>
      {children}
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}


import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

// The admin page header (Azure portal / Horizon style): breadcrumb, title and the page's main
// buttons on one row. A screen inside the page puts its main buttons there with <PageActions>
// and, on a detail screen, its object's name as the title with <PageTitle>.
type Slots = { inside: boolean; title: HTMLElement | null; actions: HTMLElement | null };
const Ctx = createContext<Slots>({ inside: false, title: null, actions: null });

export function usePageHeadSlots() {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  return { slots: { inside: true, title, actions }, titleRef: setTitle, actionsRef: setActions };
}

export function PageHeadProvider({ slots, children }: { slots: Slots; children: ReactNode }) {
  return <Ctx.Provider value={slots}>{children}</Ctx.Provider>;
}

/** The screen's main buttons, shown at the right of the page title (inline outside the admin page frame). */
export function PageActions({ children }: { children: ReactNode }) {
  const { inside, actions } = useContext(Ctx);
  if (!inside) return <div className="page-actions">{children}</div>;
  return actions ? createPortal(children, actions) : null;
}

/** A detail screen's title: the object's name, a status badge, and the way back to its list. */
export function PageTitle({ title, badge, back, icon }: { title: ReactNode; badge?: ReactNode; back?: { to: string; label: string }; icon?: ReactNode }) {
  const { inside, title: slot } = useContext(Ctx);
  const body = (
    <>
      {back && <Link to={back.to} className="ph-back"><Icon name="chevron" size={12} />{back.label}</Link>}
      <div className="ph-title-row">
        {icon && <span className="ph-icon">{icon}</span>}
        <h1>{title}</h1>
        {badge}
      </div>
    </>
  );
  if (!inside) return <div className="ph-inline">{body}</div>;
  return slot ? createPortal(body, slot) : null;
}

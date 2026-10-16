import { useEffect, useRef, useState, type ReactNode } from 'react';

// One layout for the settings pages (플랫폼 설정, 도메인, 화이트라벨): a status strip on top,
// a section list on the left that follows the scroll, and the sections stacked on the right -
// each with its title and description beside its fields - with the save bar at the bottom.

export type SettingsSectionDef = { id: string; title: string };

export function SettingsShell({ sections, status, children, footer, aside }: {
  sections: SettingsSectionDef[]; status?: ReactNode; children: ReactNode; footer?: ReactNode; aside?: ReactNode;
}) {
  const [active, setActive] = useState(sections[0]?.id);
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(`sec-${s.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) setActive(seen[0].target.id.replace(/^sec-/, ''));
    }, { rootMargin: '-80px 0px -55% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  return (
    <div className={`sshell${aside ? ' with-aside' : ''}`}>
      <nav className="snav" aria-label="sections">
        {sections.map((s) => (
          <a key={s.id} href={`#sec-${s.id}`} className={active === s.id ? 'on' : ''} aria-current={active === s.id ? 'true' : undefined}
            onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(s.id); }}>
            {s.title}
          </a>
        ))}
      </nav>
      <div className="smain" ref={main}>
        {status}
        {children}
        {footer}
      </div>
      {aside && <aside className="saside">{aside}</aside>}
    </div>
  );
}

export function SettingsSection({ id, title, desc, children }: { id: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="sset" id={`sec-${id}`} aria-labelledby={`sec-${id}-t`}>
      <header className="sset-head">
        <h2 id={`sec-${id}-t`}>{title}</h2>
        {desc && <p>{desc}</p>}
      </header>
      <div className="sset-body form">{children}</div>
    </section>
  );
}

// The strip on top: what is set now, at a glance.
export function SettingsStatus({ items }: { items: { label: string; value: ReactNode; tone?: 'ok' | 'off' | 'warn' }[] }) {
  return (
    <div className="sstatus">
      {items.map((x) => (
        <div key={x.label} className="sstatus-cell">
          <span className="sstatus-l">{x.label}</span>
          <span className={`sstatus-v${x.tone ? ` t-${x.tone}` : ''}`}>{x.value}</span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsApi, type TaskList } from '../api/ops';
import { useKind } from '../admin/pages/OpsPages';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

// The top bar's count of running Proxmox tasks (clones, migrations, backups, ...), with the
// running ones in a menu. Administrators see every task and a link to 운영 > 작업 진행; anyone
// else only their own, and the button only while something of theirs runs.
export function TaskIndicator({ console: inConsole, admin }: { console: boolean; admin: boolean }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const kind = useKind();
  const [list, setList] = useState<TaskList | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const running = list?.running ?? 0;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try { const l = await opsApi.tasks(40); if (alive) setList(l); } catch { /* the count just stays as it was */ }
      }
      if (alive) timer = setTimeout(tick, running ? 5000 : 20000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [running > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!list || (!running && !(inConsole && admin))) return null;
  const label = running ? L(`진행 중인 작업 ${running}개`, `${running} task(s) running`) : L('진행 중인 작업 없음', 'No task running');
  const shown = list.tasks.filter((t) => t.running).slice(0, 6);
  return (
    <div className="tb-user tb-tasks" ref={ref}>
      <button type="button" className="tb-icon" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="clock" size={18} />
        {running > 0 && <span className="tb-badge">{running}</span>}
      </button>
      {open && (
        <div className="menu tb-menu tb-task-menu" role="menu">
          <div className="tb-menu-head"><span className="strong">{label}</span></div>
          {shown.length === 0 && <p className="muted small menu-note">{L('지금 진행 중인 작업이 없습니다.', 'Nothing is running right now.')}</p>}
          {shown.map((t) => (
            <div key={t.upid} className="tb-task">
              <span className="strong small">{kind(t.type)}</span>
              <span className="muted small">{t.desktop?.name ?? (t.vmid !== null ? `VM ${t.vmid}` : t.node)}</span>
              {t.percent !== null
                ? <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, t.percent)}%` }} /></span>
                : <span className="muted small">{t.node}</span>}
            </div>
          ))}
          {inConsole && admin && (
            <Link role="menuitem" to="/admin/ops/tasks" className="tb-task-all" onClick={() => setOpen(false)}>
              {L('작업 진행 전체 보기', 'All tasks')}<Icon name="chevron" size={14} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

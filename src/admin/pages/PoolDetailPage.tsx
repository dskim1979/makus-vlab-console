import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Pool, Template } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { directoryApi, joinCodeText, type DomainJoin } from '../../api/directory';
import { logonApi, type LogonInstall } from '../../api/logonSso';
import { useL } from './OpsPages';

export function AddVmDialog({ pool, onClose, onAdded }: { pool: Pool; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const guests = useLoad(useCallback(() => adminApi.guests(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const [vmid, setVmid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (vmid == null || guests.state !== 'ok') return;
    const g = guests.data.find((x) => x.vmid === vmid);
    setBusy(true); setError(null);
    try {
      await adminApi.addDesktop(pool.id, { vmid, node: g?.node, type: g?.type });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('desk.addVm')} onClose={onClose} onSubmit={submit} submitLabel={t('common.add')}
      busy={busy || vmid == null} error={error}>
      <p className="muted small">{t('desk.addVmHint')}</p>
      <LoadState value={guests} retry={guests.reload}>
        {(list) => {
          const free = list.filter((g) => !g.desktop_id);
          if (free.length === 0) return <p className="muted">{t('desk.noFreeVm')}</p>;
          return (
            <div className="pick-list" role="radiogroup" aria-label={t('desk.pickVm')}>
              {list.map((g) => (
                <label key={g.vmid} className={`pick${g.desktop_id ? ' off' : ''}${vmid === g.vmid ? ' on' : ''}`}>
                  <input type="radio" name="vm" aria-label={`${g.name} (${g.vmid})`} disabled={!!g.desktop_id} checked={vmid === g.vmid}
                    onChange={() => setVmid(g.vmid)} />
                  <span className="strong">{g.name}</span>
                  <span className="muted small">{g.vmid} · {g.node} · {g.status}</span>
                  {g.desktop_id && <span className="muted small">{g.pool_id === pool.id ? '✓' : t('desk.inOtherPool')}</span>}
                </label>
              ))}
            </div>
          );
        }}
      </LoadState>
    </Dialog>
  );
}

function slug(name: string) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  // a Korean name leaves little or nothing behind: fall back to a neutral prefix
  return s.length >= 3 && /^[a-z0-9]/.test(s) ? s : 'desk';
}

// From a pool (pool given) or from 가상머신 > 템플릿 관리 (pools to pick from, template preselected).
export function CloneDialog({ pool: fixed, pools, templateVmid, defaultFull = false, onClose, onDone }: {
  pool?: Pool; pools?: Pool[]; templateVmid?: number; defaultFull?: boolean;
  onClose: () => void; onDone: (n: { kind: 'info' | 'error'; text: string }) => void;
}) {
  const { t } = useI18n();
  const [poolId, setPoolId] = useState(fixed?.id ?? pools?.[0]?.id ?? '');
  const pool = (fixed ?? pools?.find((x) => x.id === poolId))!;
  const templates = useLoad(useCallback(() => adminApi.templates(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState(slug(pool.name));
  useEffect(() => {
    if (templateVmid !== undefined && templates.state === 'ok') {
      const x = templates.data.find((y) => y.vmid === templateVmid) ?? null;
      setTpl(x);
      if (x?.type === 'lxc') setFull(true);
    }
  }, [templates, templateVmid]);
  const [full, setFull] = useState(defaultFull);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!tpl) return;
    setBusy(true); setError(null);
    try {
      const r = await adminApi.clone(pool.id, {
        template_vmid: tpl.vmid, count, name_prefix: prefix.trim(), full,
        ...(start.trim() ? { start_vmid: Number(start) } : {}),
      });
      onDone(r.failed
        ? { kind: 'error', text: t('clone.partial').replace('{n}', String(r.created.length)).replace('{vmid}', String(r.failed.vmid)).replace('{error}', r.failed.error) }
        : { kind: 'info', text: t('clone.started').replace('{n}', String(r.created.length)) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('clone.open')} onClose={onClose} onSubmit={submit} submitLabel={t('clone.submit')}
      busy={busy || !tpl} error={error}>
      {pools && !fixed && (
        <label>
          <span>{t('clone.pool')}</span>
          <select value={poolId} onChange={(e) => {
            setPoolId(e.target.value);
            const next = pools.find((x) => x.id === e.target.value);
            if (next) setPrefix(slug(next.name));
          }}>
            {pools.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      <LoadState value={templates} retry={templates.reload}>
        {(list) => list.length === 0 ? <p className="muted">{t('clone.noTemplates')}</p> : (
          <div className="pick-list" role="radiogroup" aria-label={t('clone.template')}>
            {list.map((x) => (
              <label key={x.vmid} className={`pick${tpl?.vmid === x.vmid ? ' on' : ''}`}>
                <input type="radio" name="tpl" aria-label={`${x.name} (${x.vmid})`} checked={tpl?.vmid === x.vmid}
                  onChange={() => { setTpl(x); if (x.type === 'lxc') setFull(true); }} />
                <span className="strong">{x.name}</span>
                <span className="muted small">
                  {x.vmid} · {x.node}{x.spec.cpu ? ` · ${x.spec.cpu} vCPU` : ''}{x.spec.memory_gb ? ` · ${x.spec.memory_gb} GB` : ''}
                </span>
              </label>
            ))}
          </div>
        )}
      </LoadState>
      <div className="form-row">
        <label>
          <span>{t('clone.count')}</span>
          <input type="number" min={1} max={100} required value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
        <label>
          <span>{t('clone.prefix')}</span>
          <input required pattern="[A-Za-z0-9][A-Za-z0-9-]{0,40}" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
      </div>
      <small className="muted">{t('clone.prefixHint')}</small>
      <label className="check">
        <input type="checkbox" checked={full} disabled={tpl?.type === 'lxc'} onChange={(e) => setFull(e.target.checked)} />
        <span>{t('clone.full')}</span>
      </label>
      {!full && <small className="muted">{t('clone.linkedNote')}</small>}
      <label>
        <span>{t('clone.startVmid')}</span>
        <input inputMode="numeric" pattern="[0-9]*" value={start} onChange={(e) => setStart(e.target.value.replace(/D/g, ''))} />
      </label>
    </Dialog>
  );
}

// the domain join of each desktop while the bundled directory is on; asked again every 20 s while
// one is still joining (the engine's automatic join)
export function JoinStates({ poolId, tick, onRows }: { poolId: string; tick: unknown; onRows: (r: Record<string, DomainJoin>) => void }) {
  const [on, setOn] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => { directoryApi.get().then((d) => setOn(d.enabled && d.active)).catch(() => setOn(false)); }, []);
  useEffect(() => {
    if (!on) { onRows({}); return undefined; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    directoryApi.joins(poolId).then((rows) => {
      if (!live) return;
      onRows(Object.fromEntries(rows.filter((r) => r.state !== 'unknown').map((r) => [r.desktop_id, r])));
      if (rows.some((r) => r.state === 'pending')) timer = setTimeout(() => setN((x) => x + 1), 20000);
    }).catch(() => undefined);
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [on, poolId, tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// the Windows auto sign-in module of each desktop while the pool has desktop_sso on; asked again
// every 30 s while one is waiting (the engine installs by itself)
export function LogonStates({ poolId, tick, onRows }: { poolId: string; tick: unknown; onRows: (r: Record<string, LogonInstall>) => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    logonApi.pool(poolId).then((p) => {
      if (!live) return;
      onRows(p.desktop_sso ? Object.fromEntries(p.desktops.filter((r) => r.state !== 'skipped').map((r) => [r.desktop_id, r])) : {});
      if (p.desktop_sso && p.desktops.some((r) => r.state === 'pending' || r.state === 'none')) timer = setTimeout(() => setN((x) => x + 1), 30000);
    }).catch(() => onRows({}));
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [poolId, tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function LogonChip({ l, onReinstall }: { l: LogonInstall; onReinstall: () => void }) {
  const { L } = useL();
  const again = <button type="button" className="vt-link" onClick={onReinstall}>{L('다시 설치', 'Reinstall')}</button>;
  if (l.state === 'installed') {
    return <><span className={l.current ? 'vt-st vd-tag' : 'vt-st'} title={l.at}>{L('자동 로그인', 'Auto sign-in')} {l.version}</span> {again}</>;
  }
  if (l.state === 'failed') {
    return <><span className="vt-st vt-st-error" title={l.detail}>{L('자동 로그인 설치 실패', 'Auto sign-in install failed')}</span> {again}</>;
  }
  return <span className="vt-st" title={l.detail}>{L('자동 로그인 설치 대기', 'Auto sign-in: waiting')}</span>;
}

export function JoinChip({ j }: { j: DomainJoin }) {
  const { L } = useL();
  if (j.state === 'joined') return <span className="chip chip-ok" title={j.computer}>{L('조인됨', 'Joined')}</span>;
  if (j.state === 'pending') return <span className="chip" title={j.detail}>{L('조인 중', 'Joining')}</span>;
  if (j.state === 'failed' || j.state === 'other') {
    return <span className="chip chip-warn" title={j.detail}>{L('실패', 'Failed')}: {joinCodeText(j.code, L)}</span>;
  }
  return null;
}

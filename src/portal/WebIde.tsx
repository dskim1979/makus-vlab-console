import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { hoursText, researchApi } from '../api/research';
import type { IdeFolder, IdeKind, IdeSession, IdeTarget, MyGpu } from '../api/research';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 웹 IDE: JupyterLab or VS Code in the browser, on the user's own GPU desktop or a build VM of a
// pool granted to them, started as the user in their home or scratch folder (makus-vlab
// pegaprox/api/vlab_research.py). The browser reaches it only through vlab-proxy /ide/<id>/ with a
// one-time link; the VM's port and the IDE's token never come here.

const KIND_NAME: Record<IdeKind, string> = { jupyter: 'JupyterLab', vscode: 'VS Code' };
const codeOf = (e: unknown) => ((e as ApiError).body as { code?: string } | undefined)?.code;

function useL() {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
}

export function ideErrorText(code: string | undefined, fallback: string, L: (ko: string, en: string) => string) {
  switch (code) {
    case 'NOT_RUNNING': return L('데스크톱이 꺼져 있습니다. 먼저 켜세요.', 'The desktop is off - start it first.');
    case 'NO_AGENT': return L('데스크톱의 게스트 에이전트가 응답하지 않습니다.', "The desktop's guest agent does not answer.");
    case 'WINDOWS': return L('웹 IDE는 Linux 데스크톱에서 씁니다.', 'The web IDE is for Linux desktops.');
    case 'NO_IP': return L('데스크톱 주소를 아직 모릅니다. 잠시 후 다시 하세요.', 'The desktop has no address yet. Try again shortly.');
    case 'NO_SCRATCH': return L('이 풀에는 공유 저장소의 스크래치 폴더가 없습니다.', 'This pool has no scratch folder on shared storage.');
    case 'BUSY': return L('이 데스크톱의 IDE 자리가 모두 찼습니다.', 'Every IDE slot of this desktop is in use.');
    case 'NOT_ALLOWED': return L('이 풀에서는 그 IDE를 쓸 수 없습니다.', 'This pool does not allow that IDE.');
    default: return fallback;
  }
}

export function WebIdePanel() {
  const { L, lang } = useL();
  const data = useLoad(researchApi.myIde);
  const [busy, setBusy] = useState<string | null>(null);
  // vlab-proxy sends a browser whose link was spent or whose IDE ended back here with ?ide=expired
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(() => (new URLSearchParams(window.location.search).get('ide') === 'expired'
    ? { kind: 'info', text: L('IDE 링크가 만료됐거나 IDE가 꺼졌습니다. 아래에서 다시 여세요.', 'The IDE link has expired or the IDE has ended. Open it again below.') } : null));
  const [folder, setFolder] = useState<Record<string, IdeFolder>>({});
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (data.state !== 'ok' || (data.data.desktops.length === 0 && data.data.pools.length === 0)) return null;
  const { sessions, desktops, pools } = data.data;
  const live = sessions.filter((s) => s.state === 'starting' || s.state === 'running');
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');

  // open the tab at the click (a popup blocker lets that through), then send it to the link once the IDE answers
  async function launch(target: IdeTarget, kind: IdeKind, isPool: boolean) {
    const key = `${target.id}:${kind}`;
    const tab = window.open('about:blank', '_blank');
    setBusy(key); setMsg(null);
    try {
      const f = folder[target.id] ?? 'home';
      const { session } = await researchApi.startIde(isPool ? { pool_id: target.id, kind, folder: f } : { desktop_id: target.id, kind, folder: f });
      await openWhenReady(session, tab);
    } catch (e) {
      tab?.close();
      setMsg({ kind: 'error', text: ideErrorText(codeOf(e), (e as Error).message, L) });
    } finally { setBusy(null); data.reload(); }
  }

  async function openWhenReady(s: IdeSession, tab: Window | null) {
    const until = Date.now() + 90000;
    let cur = s;
    while (cur.state === 'starting' && Date.now() < until) {
      setMsg({ kind: 'info', text: L(`${KIND_NAME[cur.kind]}을(를) 시작하는 중… (${cur.desktop})`, `Starting ${KIND_NAME[cur.kind]}… (${cur.desktop})`) });
      await new Promise((r) => { timer.current = window.setTimeout(r, 1500); });
      cur = await researchApi.ideStatus(cur.id);
    }
    if (cur.state !== 'running') {
      tab?.close();
      setMsg({ kind: 'error', text: cur.state === 'failed' ? `${L('시작하지 못했습니다', 'Could not start')}: ${cur.error}` : L('IDE가 아직 응답하지 않습니다. 잠시 후 "열기"를 누르세요.', 'The IDE does not answer yet. Press Open in a moment.') });
      return;
    }
    const { url } = await researchApi.openIde(cur.id);
    if (tab && !tab.closed) tab.location.href = url; else window.open(url, '_blank', 'noopener');
    setMsg({ kind: 'info', text: L('새 탭에서 열었습니다. 링크는 1분 동안 한 번만 쓰입니다.', 'Opened in a new tab. The link works once, for a minute.') });
  }

  async function reopen(s: IdeSession) {
    const tab = window.open('about:blank', '_blank');
    setBusy(s.id);
    try { await openWhenReady(s, tab); } catch (e) { tab?.close(); setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); data.reload(); }
  }

  async function stop(s: IdeSession) {
    if (!confirm(L(`${KIND_NAME[s.kind]} (${s.desktop})을(를) 끌까요? 저장하지 않은 노트북 내용은 잃습니다.`, `Stop ${KIND_NAME[s.kind]} on ${s.desktop}? Unsaved work is lost.`))) return;
    setBusy(s.id);
    try { await researchApi.stopIde(s.id); } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }); } finally { setBusy(null); data.reload(); }
  }

  const row = (target: IdeTarget, isPool: boolean) => (
    <div key={target.id} className="ide-target">
      <span className="quick-icon"><Icon name={isPool ? 'pool' : target.gpu ? 'gpu' : 'vm'} size={18} /></span>
      <span className="ide-name"><span className="strong">{target.name}</span>
        <span className="muted small">{isPool ? L('빌드 VM (자동 선택, GPU는 작업 큐로)', 'a build VM (picked for you; GPUs through the job queue)') : target.pool}</span></span>
      {(target.folders.home || target.folders.scratch) && (
        <select aria-label={L('작업 폴더', 'Folder')} value={folder[target.id] ?? 'home'} onChange={(e) => setFolder((o) => ({ ...o, [target.id]: e.target.value as IdeFolder }))}>
          <option value="home">{L('홈 폴더', 'Home')}</option>
          {target.folders.scratch && <option value="scratch">{L('스크래치', 'Scratch')}</option>}
        </select>
      )}
      <span className="ide-actions">{target.kinds.map((k) => (
        <button key={k} type="button" className="btn connect" disabled={busy !== null} onClick={() => launch(target, k, isPool)}>
          <Icon name="code" size={16} />{KIND_NAME[k]}</button>
      ))}</span>
    </div>
  );

  return (
    <section className="panel ide-panel">
      <div className="panel-head">
        <span className="stat-icon tone-violet"><Icon name="code" size={18} /></span>
        <div>
          <h2 className="section-title">{L('웹 IDE', 'Web IDE')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('브라우저에서 JupyterLab · VS Code를 엽니다. 내 계정으로, 공유 저장소의 내 폴더에서 실행됩니다. 이미 떠 있으면 그대로 다시 엽니다.',
            'JupyterLab or VS Code in the browser, run as you in your folder on shared storage. One already running is reopened.')}</p>
        </div>
        <div className="panel-actions"><button type="button" className="btn" onClick={data.reload} aria-label={L('새로 고침', 'Refresh')}><Icon name="refresh" size={16} /></button></div>
      </div>
      {msg && <div className={`alert small ${msg.kind === 'error' ? 'error' : 'info'}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
      <div className="ide-list">
        {desktops.map((d) => row(d, false))}
        {pools.map((p) => row(p, true))}
      </div>
      {live.length > 0 && (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('열려 있는 IDE', 'Open IDEs')}</th><th>{L('데스크톱', 'Desktop')}</th><th>{L('폴더', 'Folder')}</th><th>{L('시작', 'Started')}</th><th className="actions" /></tr></thead>
          <tbody>{live.map((s) => (
            <tr key={s.id}>
              <td className="strong">{KIND_NAME[s.kind]} {s.state === 'starting' && <span className="chip">{L('시작 중', 'starting')}</span>}</td>
              <td>{s.desktop}</td>
              <td><code className="code">{s.workdir || '~'}</code></td>
              <td className="muted small">{when(s.started_at)}</td>
              <td className="actions">
                <button type="button" className="btn-ghost small-btn" disabled={busy !== null} onClick={() => reopen(s)}>{L('열기', 'Open')}</button>
                <button type="button" className="btn-ghost small-btn danger" disabled={busy !== null} onClick={() => stop(s)}>{L('끄기', 'Stop')}</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}

// 내 자원 > 내 GPU: this month's GPU-hours against the quotas that apply, and the GPU pools.
export function MyGpuCard() {
  const { L } = useL();
  const g = useLoad(researchApi.myGpu);
  if (g.state !== 'ok' || (g.data.pools.length === 0 && g.data.quotas.length === 0 && !g.data.hours_month)) return null;
  const d: MyGpu = g.data;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="gpu" size={18} /></span>
        <div>
          <h2 className="section-title">{L('내 GPU', 'My GPUs')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('이번 달 GPU-시간은 GPU 작업(장 수 × 시간)과 카드 대여를 더한 값입니다. 할당량을 넘기면 내 작업은 큐 뒤로 갑니다.',
            "This month's GPU-hours: GPU jobs (GPUs × hours) plus card loans. Over a quota, your jobs go to the back of the queue.")}</p>
        </div>
      </div>
      <div className="gpu-quota">
        <div className="gpu-quota-item"><span className="muted small">{L('지금 쓰는 GPU', 'GPUs now')}</span><span className="big">{d.gpus_now}</span></div>
        <div className="gpu-quota-item"><span className="muted small">{L('이번 달 GPU-시간', 'GPU-hours this month')}</span><span className="big">{hoursText(d.hours_month)}</span></div>
        {d.quotas.map((q) => {
          const pct = q.monthly_gpu_hours ? Math.min(100, Math.round(100 * q.hours_month / q.monthly_gpu_hours)) : 0;
          return (
            <div key={`${q.applies_as}:${q.applies_to}`} className="gpu-quota-item wide">
              <span className="muted small">{q.applies_as === 'department' ? L(`부서 할당량 (${q.name ?? q.applies_to})`, `Department quota (${q.name ?? q.applies_to})`) : L('내 할당량', 'My quota')}
                {q.hard && <span className="chip chip-warn" style={{ marginLeft: 6 }}>{L('엄격', 'hard')}</span>}</span>
              <span>{L('동시', 'at once')} <b>{q.gpus_now}</b> / {q.max_gpus || '∞'} GPU · {L('월', 'month')} <b>{hoursText(q.hours_month)}</b> / {q.monthly_gpu_hours || '∞'} h</span>
              {q.monthly_gpu_hours > 0 && <span className="bar-track"><span className={`bar-fill${pct >= 100 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></span>}
            </div>
          );
        })}
      </div>
      {d.pools.length > 0 && (
        <div className="policy-chips">{d.pools.map((p) => <span key={p.id} className="chip">{p.name} · GPU {p.gpus_per_vm}{L('장/VM', '/VM')}{p.kind ? ` ${p.kind}` : ''}</span>)}</div>
      )}
    </section>
  );
}

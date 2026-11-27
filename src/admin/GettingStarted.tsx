import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { nextApi } from '../api/next';
import type { Summary } from '../api/types';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 시작하기 (Azure Virtual Desktop / Citrix style): the steps from an empty platform to a user on a
// desktop, each ticked when done, the next one with its button. It folds away once all are done or
// when the administrator hides it (remembered in this browser).
const KEY = 'vlab.getstarted.hidden';
function hiddenNow() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }

async function extra() {
  const clusters = await adminApi.clusters().catch(() => []);
  const live = clusters.filter((c) => c.connected);
  let templates = 0;
  for (const c of live) {
    templates += (await adminApi.templates(c.id).catch(() => [])).length;
    if (templates) break;
  }
  const pools = await adminApi.pools().catch(() => []);
  let granted = false;
  for (const p of pools.slice(0, 20)) {
    if ((await nextApi.poolGrants(p.id).catch(() => ({ grants: [] }))).grants.length) { granted = true; break; }
  }
  return { templates, granted };
}

export function GettingStarted({ s }: { s: Summary }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [hidden, setHidden] = useState(hiddenNow);
  const more = useLoad(extra);
  const x = more.state === 'ok' ? more.data : null;

  const steps: { done: boolean | null; title: string; to: string; go: string }[] = [
    { done: s.clusters.connected > 0, title: L('클러스터 연결', 'Connect a cluster'), to: '/admin/cluster/connections', go: L('연결하기', 'Connect') },
    { done: x ? x.templates > 0 : null, title: L('이미지(템플릿) 준비', 'Prepare an image (template)'), to: '/admin/images/templates/templates', go: L('이미지로', 'Images') },
    { done: s.pools.total > 0 && s.desktops.total > 0, title: L('데스크톱 배포 (풀 + VM)', 'Deploy desktops (pool + VMs)'), to: '/admin/pools/deploy', go: L('배포하기', 'Deploy') },
    { done: x ? x.granted || s.desktops.assigned > 0 : null, title: L('사용자 · 부서 지정', 'Grant users or departments'), to: '/admin/pools/list', go: L('풀에서 지정', 'Grant in a pool') },
    { done: s.desktops.in_session > 0 || s.sessions_today > 0, title: L('사용자 포털에서 첫 접속', 'First sign-in from the portal'), to: '/', go: L('포털 열기', 'Open the portal') },
  ];
  const left = steps.filter((st) => st.done === false).length;
  const allDone = steps.every((st) => st.done);
  if (hidden || allDone) return null;
  const next = steps.findIndex((st) => st.done === false);

  return (
    <section className="gs card" aria-label={L('시작하기', 'Getting started')}>
      <header className="gs-head">
        <div>
          <h2 className="card-title">{L('시작하기', 'Getting started')}</h2>
          <p className="muted small">{L(`사용자가 데스크톱에 접속하기까지 ${steps.length}단계 중 ${steps.length - left}단계를 마쳤습니다.`,
            `${steps.length - left} of ${steps.length} steps to a user on a desktop are done.`)}</p>
        </div>
        <button type="button" className="btn-ghost small-btn" onClick={() => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* private window */ } }}>
          {L('숨기기', 'Hide')}</button>
      </header>
      <ol className="gs-steps">
        {steps.map((st, i) => (
          <li key={st.title} className={st.done ? 'done' : i === next ? 'next' : ''}>
            <span className="gs-n" aria-hidden="true">{st.done ? '✓' : i + 1}</span>
            <span className="gs-title">{st.title}</span>
            {!st.done && st.done !== null && (
              <Link to={st.to} className={`btn small-btn${i === next ? ' primary' : ''}`}>{st.go}<Icon name="chevron" size={12} /></Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

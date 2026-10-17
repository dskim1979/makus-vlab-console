import { useState } from 'react';
import { nextApi } from '../api/next';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 받을 수 있는 데스크톱: pools the user is granted through their name, department or AD group.
// A dedicated pool hands out a desktop of their own; a shared pool routes them onto the
// least busy desktop. Either way the desktop then shows in the list above.
export function MyPools({ onOpen }: { onOpen: (desktopId: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const list = useLoad(nextApi.myPools);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  if (list.state !== 'ok') return null;
  const pools = list.data.filter((p) => p.action !== 'other');
  if (pools.length === 0) return null;

  async function take(id: string, action: 'claim' | 'shared') {
    setBusy(id); setNote(null);
    try {
      if (action === 'claim') {
        const r = await nextApi.claim(id);
        setNote({ id, text: r.new ? L(`${r.desktop.name} 데스크톱을 받았습니다.`, `You got ${r.desktop.name}.`) : L(`이미 받은 ${r.desktop.name}입니다.`, `You already have ${r.desktop.name}.`) });
        onOpen(r.desktop.id);
      } else {
        const r = await nextApi.route(id);
        setNote({ id, text: L(`${r.desktop.name}에 배정했습니다 (접속 ${r.sessions}/${r.limit}).`, `Routed to ${r.desktop.name} (${r.sessions}/${r.limit} sessions).`) });
        onOpen(r.desktop.id);
      }
      list.reload();
    } catch (e) {
      const msg = (e as Error).message;
      setNote({ id, error: true, text: /FULL/.test(msg) ? L('남은 데스크톱이 없습니다. 관리자에게 문의하세요.', 'No desktop left in this pool. Ask your administrator.') : msg });
    } finally { setBusy(null); }
  }

  return (
    <section className="ext-section">
      <h2 className="section-title">{L('받을 수 있는 데스크톱', 'Desktops you can get')}</h2>
      <p className="muted small">{L('나에게 열린 풀입니다. 전용 풀은 [받기], 공유 풀은 [연결].',
        'Pools open to you. Dedicated: Get. Shared: Connect.')}</p>
      <div className="ext-list">
        {pools.map((p) => (
          <article key={p.id} className="ext-card">
            <span className="ext-icon"><Icon name={p.action === 'shared' ? 'users' : 'pool'} size={20} /></span>
            <div className="ext-body">
              <h3>{p.name}</h3>
              <span className="muted small">{p.description || (p.action === 'shared' ? L('공유 풀', 'Shared pool') : L('전용 풀', 'Dedicated pool'))}
                {p.action === 'claim' && ` · ${L(`남은 ${p.free}대`, `${p.free} left`)}`}</span>
              {p.environment && (
                <div className="chip-row env-portal" title={L(`환경: ${p.environment.name}`, `Environment: ${p.environment.name}`)}>
                  <span className="chip">{p.environment.name}</span>
                  {p.environment.highlights.map((h) => <span key={h} className="chip chip-accent">{h}</span>)}
                </div>
              )}
              {note?.id === p.id && <div className={`small ${note.error ? 'text-danger' : 'muted'}`} role={note.error ? 'alert' : 'status'}>{note.text}</div>}
            </div>
            <button type="button" className="btn connect" disabled={busy !== null || (p.action === 'claim' && p.free < 1 && p.mine.length === 0)}
              onClick={() => take(p.id, p.action as 'claim' | 'shared')}>
              <Icon name={p.action === 'shared' ? 'play' : 'plus'} size={16} />
              {busy === p.id ? L('준비 중…', 'Working…') : p.action === 'shared' ? L('연결', 'Connect') : p.mine.length ? L('내 데스크톱', 'My desktop') : L('받기', 'Get one')}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

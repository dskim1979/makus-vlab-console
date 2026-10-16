import { useEffect, useState } from 'react';
import { supportApi, type BundleOptions, type BundlePreview } from '../../api/support';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정 > 지원: the support bundle for the period a problem happened in.
// The engine redacts passwords, tokens and keys; IPs (and, if asked, user names) are masked.

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const QUICK: { h: number; ko: string; en: string }[] = [
  { h: 1, ko: '최근 1시간', en: 'Last hour' }, { h: 6, ko: '6시간', en: '6 hours' }, { h: 24, ko: '24시간', en: '24 hours' },
  { h: 72, ko: '3일', en: '3 days' }, { h: 168, ko: '7일', en: '7 days' }, { h: 720, ko: '30일', en: '30 days' },
];

export function SupportPage() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [to, setTo] = useState(() => local(new Date()));
  const [from, setFrom] = useState(() => local(new Date(Date.now() - 24 * 3600000)));
  const [o, setO] = useState<BundleOptions>({ logs: true, audit: true, sessions: true, tasks: true, config: true, mask_ips: true, mask_users: false });
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const span = (new Date(to).getTime() - new Date(from).getTime()) / 3600000;
  const invalid = !(span > 0) ? L('시작이 끝보다 앞이어야 합니다.', 'The start must be before the end.')
    : span > 31 * 24 ? L('기간은 최대 31일입니다.', 'The period can be at most 31 days.') : null;

  useEffect(() => {
    if (invalid) { setPreview(null); return; }
    let live = true;
    const id = setTimeout(() => {
      supportApi.preview(from, to, o).then((p) => { if (live) { setPreview(p); setError(null); } })
        .catch((e) => { if (live) { setPreview(null); setError((e as Error).message); } });
    }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [from, to, o, invalid]);

  function quick(h: number) {
    const end = new Date();
    setTo(local(end)); setFrom(local(new Date(end.getTime() - h * 3600000)));
  }

  async function download() {
    setBusy(true); setError(null); setDone(null);
    try {
      const { blob, filename } = await supportApi.download(from, to, o);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDone(L(`${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB)을 받았습니다.`, `Saved ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const docker = `docker compose logs --since ${from} --until ${to} > container-logs.txt`;
  const PARTS: { k: keyof BundleOptions; ko: string; en: string; hint: [string, string] }[] = [
    { k: 'logs', ko: '엔진 · 클러스터 로그', en: 'Engine and cluster logs', hint: ['기간 안의 로그 줄 (파일마다 최대 8MB)', 'Lines in the period (8 MB per file at most)'] },
    { k: 'audit', ko: '작업 기록(감사)', en: 'Audit log', hint: ['누가 무엇을 바꿨는지', 'Who changed what'] },
    { k: 'sessions', ko: '접속 · 대여 · 빌드 · 경보 기록', en: 'Sessions, loans, builds, alerts', hint: ['기간에 걸친 기록', 'Records that overlap the period'] },
    { k: 'tasks', ko: 'Proxmox 작업', en: 'Proxmox tasks', hint: ['복제 · 이동 · 백업 등, 기간에 시작한 것', 'Clones, moves, backups started in the period'] },
    { k: 'config', ko: '현재 구성', en: 'Current configuration', hint: ['풀 · 데스크톱 · 게이트웨이 · 라이선스 서버 · 설정 (지금 상태)', 'Pools, desktops, gateways, licence servers, settings (as they are now)'] },
  ];
  const NAMES: Record<string, [string, string]> = {
    sessions: ['접속', 'Sessions'], card_loans: ['카드 대여', 'Card loans'], build_jobs: ['빌드 작업', 'Build jobs'], alerts: ['경보', 'Alerts'],
    audit: ['작업 기록', 'Audit entries'], tasks: ['Proxmox 작업', 'Proxmox tasks'], log_files: ['로그 파일', 'Log files'],
  };

  return (
    <>
      <p className="muted small page-intro">{L('문제가 생긴 기간을 골라 원인 파악에 필요한 자료를 ZIP 하나로 받습니다. (주)매커스시스템즈 지원팀에 보낼 때 씁니다. 비밀번호 · 토큰 · 키는 들어가지 않습니다.',
        'Pick the period a problem happened in and save what is needed to find its cause as one ZIP, for MAKUS Systems support. Passwords, tokens and keys are never included.')}</p>

      <section className="panel">
        <h2 className="section-title">{L('기간', 'Period')}</h2>
        <div className="chip-row">
          {QUICK.map((q) => <button key={q.h} type="button" className="btn-ghost small-btn" onClick={() => quick(q.h)}>{L(q.ko, q.en)}</button>)}
        </div>
        <div className="support-period">
          <label><span>{L('시작', 'From')}</span><input id="sb-from" type="datetime-local" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>{L('끝', 'To')}</span><input id="sb-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className={`small ${invalid ? 'text-danger' : 'muted'}`}>{invalid ?? L(`${span >= 48 ? `${Math.round(span / 24)}일` : `${Math.round(span)}시간`} · 서버 시간 기준 · 최대 31일`,
          `${span >= 48 ? `${Math.round(span / 24)} days` : `${Math.round(span)} hours`} · server time · 31 days at most`)}</p>
      </section>

      <section className="panel">
        <h2 className="section-title">{L('담을 내용', 'What goes in')}</h2>
        <div className="support-parts">
          {PARTS.map((p) => (
            <label key={p.k} className={`mode-card${o[p.k] ? ' on' : ''}`}>
              <input type="checkbox" checked={o[p.k]} onChange={(e) => setO({ ...o, [p.k]: e.target.checked })} />
              <span className="strong">{L(p.ko, p.en)}</span>
              <span className="muted small">{L(p.hint[0], p.hint[1])}</span>
            </label>
          ))}
        </div>
        <h3 className="support-sub">{L('개인정보', 'Privacy')}</h3>
        <label className="check"><input type="checkbox" checked={o.mask_ips} onChange={(e) => setO({ ...o, mask_ips: e.target.checked })} />
          <span>{L('IP 주소 가리기 (192.168.10.21 → 192.x.x.x)', 'Mask IP addresses (192.168.10.21 → 192.x.x.x)')}</span></label>
        <label className="check"><input type="checkbox" checked={o.mask_users} onChange={(e) => setO({ ...o, mask_users: e.target.checked })} />
          <span>{L('사용자 이름 가리기 (alice → user-1, 번들 안에서 같은 이름은 같은 번호)', 'Mask user names (alice → user-1, the same name keeps its number)')}</span></label>
      </section>

      <section className="panel">
        <h2 className="section-title">{L('미리 보기', 'Preview')}</h2>
        {preview ? (
          <div className="support-counts">
            {Object.entries(preview.counts).map(([k, v]) => (
              <div key={k}><span className="muted small">{L(...(NAMES[k] ?? [k, k]))}</span><span className="strong">{v.toLocaleString()}</span></div>
            ))}
            {Object.keys(preview.counts).length === 0 && <span className="muted small">{L('시스템 정보 · 클러스터 상태만 들어갑니다.', 'Only system information and cluster status.')}</span>}
          </div>
        ) : !invalid && <p className="muted small">{L('불러오는 중…', 'Loading…')}</p>}
        {error && <div className="alert error small" role="alert">{error}</div>}
        {done && <div className="alert info small" role="status">{done}</div>}
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy || !!invalid} onClick={download}>
            <Icon name="download" size={16} />{busy ? L('만드는 중…', 'Building…') : L('서포트 번들 받기', 'Download support bundle')}</button>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">{L('함께 보내면 좋은 것', 'Also worth sending')}</h2>
        <p className="muted small">{L('컨테이너 로그(nginx · Guacamole 포함)는 서버에서 아래 명령으로 같은 기간만큼 받습니다 (설치 폴더 deploy/ 에서).',
          'Container logs (nginx and Guacamole too) come from the server with this command, for the same period (in the deploy/ folder).')}</p>
        <div className="input-with-btn">
          <code className="code support-cmd">{docker}</code>
          <button type="button" className="btn small-btn" onClick={() => { navigator.clipboard?.writeText(docker).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
            {copied ? L('복사됨', 'Copied') : L('복사', 'Copy')}</button>
        </div>
        <p className="muted small">{L('번들을 받은 기록은 작업 기록(감사)에 남습니다.', 'Every download is written to the audit log.')}</p>
      </section>
    </>
  );
}

import { useState } from 'react';
import { warpgateApi, type SshConfigEntry } from '../api/warpgate';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 내 자원 > SSH 키 · 접속 (Warpgate 연구자 네이티브 SSH). Warpgate가 켜진 환경에서만 보인다.
// 자기 SSH 도구(PuTTY/scp/WinSCP/VS Code Remote-SSH)로 데스크톱에 붙되 Warpgate를 투명하게 거친다.
// 공개키만 다루며 개인키는 절대 받지 않는다.

function useL() {
  const { pick } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }) };
}

function Copy({ text, label }: { text: string; label: string }) {
  const { L } = useL();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost small-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? L('복사됨', 'Copied') : label}</button>
  );
}

export function SshAccessPanel() {
  const status = useLoad(warpgateApi.myStatus);
  if (status.state !== 'ok' || !status.data.enabled) return null;   // Warpgate 꺼져 있으면 숨김
  return <SshAccessBody />;
}

function SshAccessBody() {
  const { L } = useL();
  const keys = useLoad(warpgateApi.sshKeys);
  const cfg = useLoad(warpgateApi.sshConfig);
  const [label, setLabel] = useState('');
  const [pub, setPub] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    setBusy(true); setMsg(null);
    try { await warpgateApi.addSshKey(label.trim() || 'MOAVI Desk', pub.trim()); setLabel(''); setPub(''); keys.reload(); setMsg({ ok: true, text: L('공개키를 등록했습니다.', 'Public key added.') }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function del(id: string) {
    if (!confirm(L('이 공개키를 삭제할까요?', 'Delete this public key?'))) return;
    try { await warpgateApi.deleteSshKey(id); keys.reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  const entries: SshConfigEntry[] = cfg.state === 'ok' ? cfg.data.entries : [];
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{L('SSH 키 · 내 도구로 접속 (Warpgate)', 'SSH keys · connect with your tools (Warpgate)')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('PuTTY · scp · WinSCP · VS Code Remote-SSH 로 데스크톱에 붙되 Warpgate를 거칩니다. 공개키만 등록하세요 — 개인키는 올리지 마세요.',
            'Use PuTTY, scp, WinSCP or VS Code Remote-SSH through Warpgate. Register your public key only; never upload a private key.')}</p>
        </div>
      </div>

      {/* 공개키 관리 */}
      <div className="folder-list">
        <div className="strong">{L('내 공개키', 'My public keys')}</div>
        {keys.state === 'ok' && keys.data.keys.length === 0 && <p className="muted small">{L('등록된 공개키가 없습니다.', 'No public keys yet.')}</p>}
        {keys.state === 'ok' && keys.data.keys.map((k) => (
          <div key={k.id} className="folder-item">
            <span className="strong">{k.label}</span>
            <code className="code" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '32rem' }}>{k.openssh_public_key}</code>
            <button type="button" className="btn-ghost small-btn danger" onClick={() => del(k.id)}>{L('삭제', 'Delete')}</button>
          </div>
        ))}
        <label><span>{L('공개키 추가 (내용: id_ed25519.pub 등 한 줄)', 'Add public key (one line, e.g. id_ed25519.pub)')}</span>
          <textarea id="wg-pub" rows={3} value={pub} placeholder="ssh-ed25519 AAAA... me@laptop" onChange={(e) => setPub(e.target.value)} /></label>
        <div className="form-row form-row-even">
          <label><span>{L('이름표', 'Label')}</span><input id="wg-pub-label" value={label} placeholder={L('노트북', 'laptop')} onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}
        <div className="toolbar"><button type="button" className="btn primary" disabled={busy || !pub.trim()} onClick={add}><Icon name="plus" size={16} />{L('공개키 등록', 'Add key')}</button></div>
      </div>

      {/* 접속 정보 */}
      {entries.length > 0 && (
        <div className="folder-list">
          <div className="strong">{L('데스크톱 접속 (내 SSH 도구)', 'Desktop access (your SSH tools)')}</div>
          <p className="muted small">{L('MOAVI Desk 클라이언트가 아래 내용을 ~/.ssh/config 에 자동으로 넣습니다. 수동으로 쓰려면 "config 복사"로 넣으세요.',
            'The MOAVI Desk client writes this into ~/.ssh/config automatically. To do it by hand, use "Copy config".')}</p>
          {cfg.state === 'ok' && cfg.data.managed_block && (
            <div className="folder-item"><span className="strong">~/.ssh/config</span>
              <Copy text={cfg.data.managed_block} label={L('전체 config 복사', 'Copy all config')} /></div>
          )}
          {entries.map((e) => (
            <div key={e.desktop_id} className="folder-item">
              <span className="strong">{e.desktop_name}</span>
              <span className="folder-paths">
                <span><span className="muted small">ssh </span><code className="code">{e.ssh_command}</code> <Copy text={e.ssh_command} label={L('복사', 'Copy')} /></span>
                <span><span className="muted small">Host </span><code className="code">{e.hostname}:{e.port}</code></span>
                <span><span className="muted small">User </span><code className="code">{e.user}</code> <Copy text={e.user} label={L('복사', 'Copy')} /></span>
                <span><Copy text={e.config_snippet} label={L('이 항목 config 복사', 'Copy this entry')} /></span>
              </span>
            </div>
          ))}
          <p className="muted small">{L('VS Code: Remote-SSH에서 호스트 이름(moavi-…)을 고르면 됩니다. PuTTY/WinSCP: 호스트에 위 Host 주소·포트, 사용자 이름에 위 User 값을 넣고 개인키를 지정하세요. Warpgate가 대상으로 중계하고 세션을 기록합니다.',
            'VS Code: pick the host name (moavi-…) in Remote-SSH. PuTTY/WinSCP: use the Host address/port above and the User value as the login, with your private key. Warpgate relays to the target and records the session.')}</p>
        </div>
      )}
    </section>
  );
}

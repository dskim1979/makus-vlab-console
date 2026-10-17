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
        <div className="form">
          <label><span>{L('공개키 추가 — id_ed25519.pub 같은 .pub 파일 내용 한 줄', 'Add a public key - one line from a .pub file such as id_ed25519.pub')}</span>
            <textarea id="wg-pub" rows={2} value={pub} placeholder="ssh-ed25519 AAAA... me@laptop" onChange={(e) => setPub(e.target.value)} /></label>
          <div className="form-row form-row-wide">
            <label><span>{L('이름표', 'Label')}</span><input id="wg-pub-label" value={label} placeholder={L('연구실 노트북', 'lab laptop')} onChange={(e) => setLabel(e.target.value)} /></label>
            <label><span>&nbsp;</span><button type="button" className="btn primary" disabled={busy || !pub.trim()} onClick={add}><Icon name="plus" size={16} />{L('공개키 등록', 'Add key')}</button></label>
          </div>
          {msg && <p className={`alert small ${msg.ok ? 'info' : 'error'}`}>{msg.text}</p>}
        </div>
      </div>

      {/* 접속 정보 */}
      {entries.length > 0 && (
        <div className="folder-list">
          <div className="strong">{L('데스크톱 접속 (내 SSH 도구)', 'Desktop access (your SSH tools)')}</div>
          <p className="muted small" style={{ margin: 0 }}>{L('MOAVI Desk 클라이언트가 아래 블록을 ~/.ssh/config 에 자동으로 넣습니다. 브라우저만 쓰면 아래에서 복사해 직접 넣으세요. 그 뒤 터미널에서 ssh 명령 한 줄이면 됩니다.',
            'The MOAVI Desk client writes this block into ~/.ssh/config for you. Browser only? Copy it in yourself; then one ssh command is all it takes.')}</p>
          {entries.map((e) => (
            <div key={e.desktop_id} className="ssh-entry">
              <div className="ssh-entry-head">
                <span className="strong">{e.desktop_name}</span>
                <code className="code">{e.ssh_command}</code>
                <Copy text={e.ssh_command} label={L('명령 복사', 'Copy command')} />
                <span className="muted small">Host <code className="code">{e.hostname}:{e.port}</code></span>
                <span className="muted small">User <code className="code">{e.user}</code></span>
                <Copy text={e.user} label={L('User 복사', 'Copy user')} />
              </div>
              <pre className="job-output snippet">{e.config_snippet}</pre>
            </div>
          ))}
          {cfg.state === 'ok' && cfg.data.managed_block && (
            <div className="toolbar"><Copy text={cfg.data.managed_block} label={L('전체 ~/.ssh/config 블록 복사', 'Copy the whole ~/.ssh/config block')} /></div>
          )}
          <div className="strong">{L('도구별 사용법', 'How to use with your tools')}</div>
          <ul className="muted small ssh-howto">
            <li><b>VS Code</b> — {L('Remote-SSH 확장 → "Connect to Host" → moavi-… 이름을 고릅니다(위 블록이 ~/.ssh/config 에 있어야 함).', 'Remote-SSH extension, "Connect to Host", pick a moavi-… name (the block above must be in ~/.ssh/config).')}</li>
            <li><b>PuTTY</b> — {L('Host Name 에 위 Host 주소, Port 에 포트, Connection › Data › Auto-login username 에 위 User 값, SSH › Auth 에 개인키(.ppk).', 'Host Name = the Host address, Port = the port, Connection > Data > Auto-login username = the User value, SSH > Auth = your private key (.ppk).')}</li>
            <li><b>WinSCP</b> — {L('SFTP, 호스트·포트·사용자 이름은 PuTTY 와 같고, 고급 › SSH › 인증에 개인키. 파일 전송은 풀 정책과 Warpgate 기록을 따릅니다.', 'SFTP, the same host, port and user as PuTTY, Advanced > SSH > Authentication = your private key. Transfers follow the pool policy and are recorded by Warpgate.')}</li>
          </ul>
        </div>
      )}
    </section>
  );
}

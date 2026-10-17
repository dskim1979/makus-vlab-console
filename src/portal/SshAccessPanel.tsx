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

  const keyError = (code: string) => code === 'PRIVATE_KEY'
    ? L('개인키는 올릴 수 없습니다. .pub 파일(공개키) 한 줄만 넣으세요.', 'A private key cannot be uploaded. Paste one line from your .pub file (the public key).')
    : code === 'BAD_PUBLIC_KEY'
      ? L('OpenSSH 공개키 한 줄(ssh-ed25519 ...)을 넣으세요.', 'Paste one OpenSSH public key line (ssh-ed25519 ...).')
      : code === 'WG_OFF' || code === 'WG_API' || code === 'WG_UNREACHABLE'
        ? L('지금은 Warpgate에 공개키를 등록할 수 없습니다. 잠시 뒤 다시 시도하거나 관리자에게 문의하세요.', 'The key cannot be registered with Warpgate right now. Try again later or contact your administrator.')
        : L('공개키를 등록하지 못했습니다.', 'Could not add the public key.');

  async function add() {
    setMsg(null);
    const text = pub.trim();
    // checked here first: a pasted private key is cleared and never sent anywhere
    if (/PRIVATE KEY|PuTTY-User-Key-File/i.test(text)) { setPub(''); setMsg({ ok: false, text: keyError('PRIVATE_KEY') }); return; }
    if (!/^(ssh-|ecdsa-|sk-)\S+\s+\S+/.test(text)) { setMsg({ ok: false, text: keyError('BAD_PUBLIC_KEY') }); return; }
    setBusy(true);
    try { await warpgateApi.addSshKey(label.trim() || 'MOAVI Desk', text); setLabel(''); setPub(''); keys.reload(); setMsg({ ok: true, text: L('공개키를 등록했습니다.', 'Public key added.') }); }
    catch (e) { setMsg({ ok: false, text: keyError((e as Error).message) }); } finally { setBusy(false); }
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
          <p className="muted small" style={{ margin: 0 }}>{L('내 SSH 도구로 Warpgate를 거쳐 데스크톱에 접속합니다.', 'Reach your desktops with your own SSH tools, through Warpgate.')}</p>
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
          <label><span>{L('공개키 추가 (.pub 한 줄)', 'Add a public key (one .pub line)')}</span>
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
          <p className="muted small" style={{ margin: 0 }}>{L('MOAVI Desk 클라이언트가 ~/.ssh/config 에 자동으로 넣습니다.', 'The MOAVI Desk client adds this to ~/.ssh/config for you.')}</p>
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
          <details className="wg-more">
            <summary>{L('사용 방법', 'How to use')}</summary>
            <ul className="muted small ssh-howto">
              <li><b>{L('터미널', 'Terminal')}</b> — <code className="code">ssh moavi-…</code>, <code className="code">scp 파일 moavi-…:</code></li>
              <li><b>VS Code</b> — {L('Remote-SSH › Connect to Host › moavi-… 선택', 'Remote-SSH › Connect to Host › pick moavi-…')}</li>
              <li><b>PuTTY</b> — {L('Host·Port 와 User 값, SSH › Auth 에 개인키(.ppk)', 'Host, Port and the User value; SSH › Auth = your private key (.ppk)')}</li>
              <li><b>WinSCP</b> — {L('SFTP, PuTTY 와 같은 값', 'SFTP, the same values as PuTTY')}</li>
              <li>{L('공개키만 등록합니다. 개인키는 PC 밖으로 보내지 마세요.', 'Register only the public key; the private key stays on your PC.')}</li>
              <li>{L('파일 전송은 풀 정책을 따르고 Warpgate가 기록합니다.', 'File transfers follow the pool policy and are recorded by Warpgate.')}</li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

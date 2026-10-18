import { useState } from 'react';
import { Link } from 'react-router-dom';
import { warpgateApi, type RdpgwStatus, type WarpgateConfig } from '../../api/warpgate';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsSection, SettingsShell, SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정 > Warpgate: 접근 게이트웨이(bastion) 설정 (makus-vlab pegaprox/api/vlab_warpgate.py).
// 모든 데스크톱 RDP/SSH/VNC를 Warpgate 하나로 중계해 대상 IP를 숨기고 세션을 녹화하며, 접속할 때
// 비밀번호를 저장·전달하지 않는다(1회용 티켓). 관리자 API 토큰은 코어 DB 키로 봉인되어 저장된다.

function useL() {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
}

export function WarpgatePage() {
  const { L } = useL();
  const cfg = useLoad(warpgateApi.get);
  const c = cfg.state === 'ok' ? cfg.data.config : null;
  return (
    <SettingsShell sections={[{ id: 'warpgate', title: L('보안 게이트웨이', 'Security gateway') }, { id: 'devices', title: L('장치 연결 방식', 'Device route') },
      { id: 'sessions', title: L('세션 녹화', 'Session recordings') }]}
      status={
        <SettingsStatus items={[
          { label: L('사용', 'Enabled'), value: c ? (c.enabled ? L('켜짐', 'on') : L('꺼짐', 'off')) : '-', tone: c?.enabled ? 'ok' : 'off' },
          { label: L('연결', 'Connection'), value: c ? (c.last_ok === true ? L('정상', 'ok') : c.last_ok === false ? L('오류', 'error') : L('확인 전', 'unchecked')) : '-', tone: c?.last_ok === true ? 'ok' : c?.last_ok === false ? 'warn' : undefined },
          { label: L('동기화된 대상', 'Targets'), value: cfg.state === 'ok' ? String(cfg.data.targets) : '-' },
          { label: L('앱·RDP 파일', 'App / RDP file'), value: c ? (c.rdp_via_warpgate ? L('보안 게이트웨이', 'Security gateway') : L('직접', 'direct')) : '-' },
        ]} />}>
      <LoadState value={cfg} retry={cfg.reload}>{(d) => <WarpgateForm initial={d.config} onSaved={cfg.reload} />}</LoadState>
    </SettingsShell>
  );
}

function WarpgateForm({ initial, onSaved }: { initial: WarpgateConfig; onSaved: () => void }) {
  const { L } = useL();
  const [f, setF] = useState(initial);
  const [token, setToken] = useState('');          // write-only; 빈 값이면 기존 토큰 유지
  const [nlaPw, setNlaPw] = useState('');           // write-only
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const saved = await warpgateApi.save({
        base_url: f.base_url, ssh_port: f.ssh_port, rdp_port: f.rdp_port, vnc_port: f.vnc_port,
        verify_tls: f.verify_tls, enabled: f.enabled, rdp_nla_user: f.rdp_nla_user,
        rdp_via_warpgate: f.rdp_via_warpgate, allow_direct_fallback: f.allow_direct_fallback,
        ...(token ? { admin_token: token } : {}),
        ...(nlaPw ? { rdp_nla_password: nlaPw } : {}),
      });
      setF(saved); setToken(''); setNlaPw('');
      setMsg({ ok: true, text: L('저장했습니다.', 'Saved.') }); onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await warpgateApi.test();
      setF(r.config);
      setMsg({ ok: r.ok, text: r.ok ? L(`연결 정상 — ${r.detail}`, `Connected — ${r.detail}`) : L(`연결 실패 — ${r.detail}`, `Failed — ${r.detail}`) });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function openSessions() {
    try { window.open(await warpgateApi.sessionsUrl(), '_blank', 'noopener'); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  return (
    <>
      <SettingsSection id="warpgate" title={L('보안 게이트웨이', 'Security gateway')}
        desc={L('데스크톱 RDP·SSH·VNC를 보안 게이트웨이 한 곳으로 중계합니다.', 'Relays desktop RDP, SSH and VNC through one Warpgate.')}>
        <label className="check"><input id="wg-on" type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span>{L('보안 게이트웨이 사용', 'Use Warpgate')}</span></label>

        <label><span>{L('Base URL', 'Base URL')}</span>
          <input id="wg-url" value={f.base_url} placeholder="https://warpgate.lab.example:8888" onChange={(e) => setF({ ...f, base_url: e.target.value.trim() })} /></label>

        <label><span>{L('관리자 API 토큰', 'Admin API token')}</span>
          <input id="wg-token" type="password" autoComplete="off" value={token}
            placeholder={f.has_token ? L('저장됨 — 바꿀 때만 입력', 'Saved; type only to change') : L('보안 게이트웨이 관리 화면에서 발급', 'Issue it in the Warpgate admin UI')}
            onChange={(e) => setToken(e.target.value)} />
          <small className="muted">{L('봉인 저장, 다시 표시하지 않음', 'Stored sealed, never shown again')}</small></label>

        <div className="form-row form-row-even">
          <label><span>{L('SSH 포트', 'SSH port')}</span><input id="wg-ssh" type="number" min={1} max={65535} value={f.ssh_port} onChange={(e) => setF({ ...f, ssh_port: Number(e.target.value) || 0 })} /></label>
          <label><span>{L('RDP 포트', 'RDP port')}</span><input id="wg-rdp" type="number" min={1} max={65535} value={f.rdp_port} onChange={(e) => setF({ ...f, rdp_port: Number(e.target.value) || 0 })} /></label>
          <label><span>{L('VNC 포트', 'VNC port')}</span><input id="wg-vnc" type="number" min={1} max={65535} value={f.vnc_port} onChange={(e) => setF({ ...f, vnc_port: Number(e.target.value) || 0 })} /></label>
        </div>

        <label className="check"><input id="wg-rdp-via" type="checkbox" checked={!!f.rdp_via_warpgate} onChange={(e) => setF({ ...f, rdp_via_warpgate: e.target.checked })} />
          <span>{L('전용 앱·RDP 파일을 보안 게이트웨이 경유로', 'Windows app / RDP file through Warpgate')}</span></label>

        <label className="check"><input id="wg-fallback" type="checkbox" checked={!!f.allow_direct_fallback} onChange={(e) => setF({ ...f, allow_direct_fallback: e.target.checked })} />
          <span>{L('보안 게이트웨이 장애 시 직접 접속 허용', 'Allow direct access when Warpgate is down')}</span></label>
        {f.allow_direct_fallback && (
          <div className="alert small error">{L('보안 약화: 장애 중에는 녹화·티켓 없이 직접 연결됩니다.', 'Weakens security: during an outage connects go direct, unrecorded.')}</div>
        )}

        <label className="check"><input id="wg-tls" type="checkbox" checked={f.verify_tls} onChange={(e) => setF({ ...f, verify_tls: e.target.checked })} />
          <span>{L('TLS 인증서 검증', 'Verify the TLS certificate')}</span></label>

        <div className="form-row form-row-even">
          <label><span>{L('RDP NLA 서비스 계정', 'RDP NLA service account')}</span>
            <input id="wg-nla-user" value={f.rdp_nla_user} placeholder="moavi-nla" onChange={(e) => setF({ ...f, rdp_nla_user: e.target.value.trim() })} /></label>
          <label><span>{L('RDP NLA 비밀번호', 'RDP NLA password')}</span>
            <input id="wg-nla-pw" type="password" autoComplete="off" value={nlaPw}
              placeholder={f.has_nla_password ? L('저장됨 — 바꿀 때만 입력', 'Saved; type only to change') : L('NLA가 필요할 때만', 'Only if NLA is required')}
              onChange={(e) => setNlaPw(e.target.value)} /></label>
        </div>

        <details className="wg-more">
          <summary>{L('자세히', 'Details')}</summary>
          <ul className="muted small ssh-howto">
            <li>{L('브라우저 RDP 제공 — 포털 "브라우저 RDP로 열기"가 이 설정을 따릅니다. 보안 게이트웨이로 바꾸면 사용자는 보안 게이트웨이 화면에 로그인해 데스크톱을 엽니다.',
              'Browser RDP served by - the portal\'s "Open in browser RDP" follows it. With Warpgate, users sign in to Warpgate and open the desktop there.')}</li>
            <li>{L('앱·RDP 파일 — .rdp가 데스크톱 대신 보안 게이트웨이를 향하고, 사용자 이름에 1회용 티켓이 들어갑니다. 비밀번호는 없습니다.',
              'App / RDP file - the .rdp points at Warpgate, with a single-use ticket as the user name and no password.')}</li>
            <li>{L('장애 시 — 기본은 "보안 게이트웨이에 연결할 수 없습니다"로 막습니다. 직접 접속 허용은 장애 대응 중에만 잠깐 켜세요. 직접 접속을 막은 현장에서는 어차피 실패합니다.',
              'When Warpgate is down - connects are refused by default. Allow the direct path only briefly during an outage; it fails anyway where direct access is blocked.')}</li>
            <li>{L('RDP 로그인 — 자동 로그인하지 않고 데스크톱 로그온 화면을 띄웁니다. 사용자는 본인 계정으로 들어갑니다. NLA 서비스 계정은 네트워크 수준 인증용이며 사용자 비밀번호가 아닙니다. NLA를 끈 데스크톱이면 비워 두세요.',
              'RDP sign-in - no auto logon; the desktop\'s logon screen asks for the user\'s own account. The NLA service account only passes network-level auth and is not a user password. Leave it empty if NLA is off.')}</li>
            <li>{L('API 토큰 — 보안 게이트웨이 관리 화면에서 관리자 역할 토큰을 만드세요. 자체 서명 인증서면 TLS 검증을 끄세요.',
              'API token - create an admin-role token in the Warpgate admin UI. Turn TLS verification off for a self-signed certificate.')}</li>
          </ul>
        </details>

        {msg && <p className={`alert small ${msg.ok ? 'info' : 'error'}`}>{msg.text}</p>}
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="shield" size={16} />{L('저장', 'Save')}</button>
          <button type="button" className="btn" disabled={busy || !f.base_url || (!f.has_token && !token)} onClick={test}><Icon name="refresh" size={16} />{L('연결 테스트', 'Test connection')}</button>
        </div>
      </SettingsSection>

      <DevicesSection />

      <SettingsSection id="sessions" title={L('세션 녹화', 'Session recordings')}
        desc={L('보안 게이트웨이가 녹화한 세션을 다시 봅니다.', 'Review the sessions Warpgate recorded.')}>
        <div className="toolbar">
          <button type="button" className="btn" disabled={!f.base_url} onClick={openSessions}><Icon name="globe" size={16} />{L('녹화 세션 열기', 'Open recorded sessions')}</button>
        </div>
      </SettingsSection>
    </>
  );
}

// 장치 연결 방식 (rdpgw): set up in the deploy's .env; the pools that use it choose it in their policy
function DevicesSection() {
  const { L } = useL();
  const st = useLoad(warpgateApi.rdpgw);
  return (
    <SettingsSection id="devices" title={L('장치 연결 방식', 'Device route')}
      desc={L('RDP 파일로 내 PC의 드라이브·프린터·USB를 쓰게 합니다. 녹화하지 않습니다.', 'Lets the RDP file use the drives, printers and USB of the PC. Not recorded.')}>
      <LoadState value={st} retry={st.reload}>{(d: RdpgwStatus) => (
        <>
          <dl className="review-list">
            <dt>{L('상태', 'State')}</dt>
            <dd>{d.config.enabled
              ? (d.reachable ? <span className="status st-ready"><span className="dot" />{L('켜짐 · 응답함', 'On, answering')}</span>
                : <span className="status st-error"><span className="dot" />{L('켜짐 · 응답 없음', 'On, not answering')}</span>)
              : d.config.problem ? <span className="status st-error"><span className="dot" />{d.config.problem}</span>
                : <span className="muted">{L('꺼짐', 'Off')}</span>}</dd>
            <dt>{L('접속 주소', 'Address')}</dt><dd>{d.config.host || '-'}</dd>
            <dt>{L('1회용 토큰', 'One-time token')}</dt>
            <dd>{L(`${d.config.token_minutes}분 · 그 데스크톱만${d.config.verify_client_ip ? ' · 받은 PC에서만' : ''}`,
              `${d.config.token_minutes} min, that desktop only${d.config.verify_client_ip ? ', from the PC that got it' : ''}`)}</dd>
            <dt>{L('쓰는 풀', 'Pools')}</dt>
            <dd>{d.pools.length ? d.pools.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link to={`/admin/pools/list/${encodeURIComponent(p.id)}`}>{p.name}</Link></span>)
              : <span className="muted">{L('없음 — 풀 정책 > USB · 장치에서 고릅니다', 'None - pick it in the pool policy (USB / devices)')}</span>}</dd>
          </dl>
          <details className="wg-more">
            <summary>{L('사용 방법', 'How to')}</summary>
            <ul className="muted small ssh-howto">
              <li>{L('켜기 — 서버 .env에 VLAB_RDPGW=1, VLAB_RDPGW_KEY(32자, openssl rand -hex 16)를 넣고 docker compose up -d.',
                'Turn on - in the .env of the server set VLAB_RDPGW=1 and VLAB_RDPGW_KEY (32 characters, openssl rand -hex 16), then docker compose up -d.')}</li>
              <li>{L('사용자 PC — 콘솔 인증서가 자체 서명이면 포털의 "게이트웨이 인증서 받기"로 받아 "신뢰할 수 있는 루트 인증 기관"에 한 번 설치합니다.',
                'User PCs - with a self-signed console certificate, get it from the portal ("Get the gateway certificate") and install it once under Trusted Root Certification Authorities.')}</li>
              <li>{L('USB — 사용자 PC에서 RemoteFX USB 리디렉션 정책을 켜야 보이는 장치가 있습니다. 데스크톱 쪽 허용·차단은 풀 정책을 따릅니다.',
                'USB - some devices need RemoteFX USB redirection allowed by policy on the PC of the user. The desktop side follows the pool policy.')}</li>
            </ul>
          </details>
        </>
      )}</LoadState>
    </SettingsSection>
  );
}

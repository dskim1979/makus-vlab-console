import { useState } from 'react';
import { warpgateApi, type WarpgateConfig } from '../../api/warpgate';
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
    <SettingsShell sections={[{ id: 'warpgate', title: 'Warpgate' }, { id: 'sessions', title: L('세션 녹화', 'Session recordings') }]}
      status={
        <SettingsStatus items={[
          { label: L('사용', 'Enabled'), value: c ? (c.enabled ? L('켜짐', 'on') : L('꺼짐', 'off')) : '-', tone: c?.enabled ? 'ok' : 'off' },
          { label: L('연결', 'Connection'), value: c ? (c.last_ok === true ? L('정상', 'ok') : c.last_ok === false ? L('오류', 'error') : L('확인 전', 'unchecked')) : '-', tone: c?.last_ok === true ? 'ok' : c?.last_ok === false ? 'warn' : undefined },
          { label: L('동기화된 대상', 'Targets'), value: cfg.state === 'ok' ? String(cfg.data.targets) : '-' },
          { label: L('브라우저 RDP', 'Browser RDP'), value: c ? (c.web_rdp_provider === 'warpgate' ? 'Warpgate' : 'Guacamole') : '-' },
          { label: L('앱·RDP 파일', 'App / RDP file'), value: c ? (c.rdp_via_warpgate ? 'Warpgate' : L('직접', 'direct')) : '-' },
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
        verify_tls: f.verify_tls, enabled: f.enabled, rdp_nla_user: f.rdp_nla_user, web_rdp_provider: f.web_rdp_provider,
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
      <SettingsSection id="warpgate" title="Warpgate"
        desc={L('모든 데스크톱 RDP/SSH/VNC를 Warpgate 하나로 중계합니다. 대상 IP가 숨고 세션이 녹화되며, 접속할 때 사용자·데스크톱 비밀번호를 저장하지 않습니다(그 사용자·대상에만 쓸 수 있는 1회용 티켓). Guacamole 등 기존 경로와 함께 켤 수 있습니다.',
          'Relays all desktop RDP/SSH/VNC through one Warpgate. Target IPs are hidden, sessions recorded, and no password is stored on connect (a single-use ticket scoped to the user and target). Works alongside Guacamole.')}>
        <label className="check"><input id="wg-on" type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span>{L('Warpgate 사용 (포털 연결이 Warpgate를 거칩니다)', 'Use Warpgate (portal connects go through it)')}</span></label>

        <label><span>{L('Base URL (관리자 UI · API)', 'Base URL (admin UI / API)')}</span>
          <input id="wg-url" value={f.base_url} placeholder="https://warpgate.lab.example:8888" onChange={(e) => setF({ ...f, base_url: e.target.value.trim() })} /></label>

        <label><span>{L('관리자 API 토큰', 'Admin API token')}</span>
          <input id="wg-token" type="password" autoComplete="off" value={token}
            placeholder={f.has_token ? L('저장됨 — 바꿀 때만 입력', 'Saved; type only to change') : L('Warpgate 관리자 UI에서 발급', 'Issue it in the Warpgate admin UI')}
            onChange={(e) => setToken(e.target.value)} />
          <small className="muted">{L('코어 DB 키로 봉인되어 저장됩니다(다시 읽히지 않음). Warpgate 관리자 UI에서 관리자 역할 토큰을 만드세요.',
            'Sealed with the core DB key (never read back). Create an admin-role token in the Warpgate admin UI.')}</small></label>

        <div className="form-row form-row-even">
          <label><span>{L('SSH 포트', 'SSH port')}</span><input id="wg-ssh" type="number" min={1} max={65535} value={f.ssh_port} onChange={(e) => setF({ ...f, ssh_port: Number(e.target.value) || 0 })} /></label>
          <label><span>{L('RDP 포트', 'RDP port')}</span><input id="wg-rdp" type="number" min={1} max={65535} value={f.rdp_port} onChange={(e) => setF({ ...f, rdp_port: Number(e.target.value) || 0 })} /></label>
          <label><span>{L('VNC 포트', 'VNC port')}</span><input id="wg-vnc" type="number" min={1} max={65535} value={f.vnc_port} onChange={(e) => setF({ ...f, vnc_port: Number(e.target.value) || 0 })} /></label>
        </div>

        <label><span>{L('브라우저 RDP 제공', 'Browser RDP served by')}</span>
          <select id="wg-provider" value={f.web_rdp_provider} onChange={(e) => setF({ ...f, web_rdp_provider: e.target.value as 'guac' | 'warpgate' })}>
            <option value="guac">{L('Guacamole (기본, 항상 동작)', 'Guacamole (default, always on)')}</option>
            <option value="warpgate">{L('Warpgate (실클러스터 검증 후 전환)', 'Warpgate (switch after real-cluster verification)')}</option>
          </select>
          <small className="muted">{L('Warpgate 웹 RDP를 실제 클러스터에서 확인하기 전에는 Guacamole로 두세요. 포털의 "브라우저 RDP로 열기"는 이 설정을 따르고, "Warpgate로 연결"은 항상 따로 있습니다.',
            'Keep Guacamole until Warpgate web RDP is verified on a real cluster. The portal\'s "Open in browser RDP" follows this; "Connect via Warpgate" is always separate.')}</small></label>

        <label className="check"><input id="wg-rdp-via" type="checkbox" checked={!!f.rdp_via_warpgate} onChange={(e) => setF({ ...f, rdp_via_warpgate: e.target.checked })} />
          <span>{L('전용 앱·RDP 파일을 Warpgate 경유로 (1회용 티켓, 비밀번호 없음)', 'Windows app / RDP file through Warpgate (single-use ticket, no password)')}</span></label>
        <small className="muted hint-indent">{L('켜면 MOAVI Desk 클라이언트·mstsc가 받는 .rdp가 데스크톱 주소 대신 Warpgate를 향하고, 사용자 이름에 그 사용자·데스크톱 전용 1회용 티켓이 들어갑니다. 데스크톱이 로그인을 물으면 사용자가 본인(AD) 계정으로 들어갑니다. 끄면 지금처럼 직접/RD 게이트웨이 .rdp. Warpgate가 응답하지 않으면 접속을 거부합니다(아래 옵션을 켠 경우만 직접 연결).',
          'On: the .rdp the MOAVI Desk client / mstsc gets points at Warpgate instead of the desktop, with a single-use ticket for that user and desktop as the user name. If the desktop asks to sign in, the user uses their own (AD) account. Off: the direct / RD Gateway .rdp as today. If Warpgate does not answer, the connect is refused (unless the option below allows the direct path).')}</small>

        <label className="check"><input id="wg-fallback" type="checkbox" checked={!!f.allow_direct_fallback} onChange={(e) => setF({ ...f, allow_direct_fallback: e.target.checked })} />
          <span>{L('Warpgate 장애 시 직접 접속 허용 (보안 약화)', 'Allow direct access when Warpgate is down (weakens security)')}</span></label>
        {f.allow_direct_fallback
          ? <div className="alert small error">{L('켜져 있음: Warpgate가 응답하지 않으면 그 접속은 Warpgate를 거치지 않고 직접 .rdp·Guacamole로 열립니다. 세션 녹화·1회용 티켓·대상 숨김이 적용되지 않고, 데스크톱 직접 접속을 막은 현장에서는 어차피 실패합니다. 장애 대응 중에만 잠깐 켜세요.',
              'On: when Warpgate does not answer, the connect skips Warpgate and opens the direct .rdp / Guacamole - no recording, no single-use ticket, the desktop address is exposed, and it fails anyway where direct access is blocked. Turn it on only briefly during an outage.')}</div>
          : <small className="muted hint-indent">{L('꺼짐(권장): Warpgate로 전환한 접속은 Warpgate가 응답하지 않으면 "Warpgate에 연결할 수 없습니다" 오류로 막습니다(bastion 우회 없음).',
              'Off (recommended): connects switched to Warpgate are refused with "Cannot reach Warpgate" while it is down (no bastion bypass).')}</small>}

        <label className="check"><input id="wg-tls" type="checkbox" checked={f.verify_tls} onChange={(e) => setF({ ...f, verify_tls: e.target.checked })} />
          <span>{L('Warpgate의 TLS 인증서 검증 (자체 서명이면 끄기)', 'Verify Warpgate\'s TLS certificate (off for self-signed)')}</span></label>

        <div className="form-row form-row-even">
          <label><span>{L('RDP NLA 서비스 계정 (선택)', 'RDP NLA service account (optional)')}</span>
            <input id="wg-nla-user" value={f.rdp_nla_user} placeholder="moavi-nla" onChange={(e) => setF({ ...f, rdp_nla_user: e.target.value.trim() })} /></label>
          <label><span>{L('RDP NLA 비밀번호 (선택)', 'RDP NLA password (optional)')}</span>
            <input id="wg-nla-pw" type="password" autoComplete="off" value={nlaPw}
              placeholder={f.has_nla_password ? L('저장됨 — 바꿀 때만 입력', 'Saved; type only to change') : L('NLA가 필요할 때만', 'only if NLA is enforced')}
              onChange={(e) => setNlaPw(e.target.value)} /></label>
        </div>
        <p className="muted small">{L('RDP는 자동 로그인하지 않고 데스크톱의 Windows 로그온 화면을 띄웁니다(interactive_logon). 이 서비스 계정은 네트워크 수준 인증(CredSSP) 통과용이며 사용자 비밀번호가 아닙니다. 데스크톱에서 NLA를 끄면 비워 두세요.',
          'RDP shows the desktop\'s Windows logon screen instead of signing in (interactive_logon). This service account only passes network-level auth (CredSSP); it is not a user password. Leave empty if NLA is disabled on the desktops.')}</p>

        {msg && <p className={`alert small ${msg.ok ? 'info' : 'error'}`}>{msg.text}</p>}
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="shield" size={16} />{L('저장', 'Save')}</button>
          <button type="button" className="btn" disabled={busy || !f.base_url || (!f.has_token && !token)} onClick={test}><Icon name="refresh" size={16} />{L('연결 테스트', 'Test connection')}</button>
        </div>
      </SettingsSection>

      <SettingsSection id="sessions" title={L('세션 녹화', 'Session recordings')}
        desc={L('Warpgate가 모든 세션을 녹화합니다. 관리자 녹화 페이지에서 사용자·대상·시각별로 다시 볼 수 있습니다.',
          'Warpgate records every session. Review them by user, target and time in its admin page.')}>
        <div className="toolbar">
          <button type="button" className="btn" disabled={!f.base_url} onClick={openSessions}><Icon name="globe" size={16} />{L('녹화 세션 열기', 'Open recorded sessions')}</button>
        </div>
      </SettingsSection>
    </>
  );
}

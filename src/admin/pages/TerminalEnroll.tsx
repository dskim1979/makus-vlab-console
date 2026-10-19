import { useState } from 'react';
import { useFeatures } from '../../features';
import { enrollApi, kioskPasswordHash, msiexecLine, saveFile, serverOfConsole, type EnrollCode, type EnrollCodeStatus, type InstallSettings } from '../../api/enroll';
import type { Lab, Terminal } from '../../api/types';
import { usersApi } from '../../api/users';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// LAB > 단말 관리: room PCs through the MOAVI Desk Agent. An enrolment code (made here, or a token from the
// portal's "실습실 PC로 설치") goes into a one-file installer the engine makes; the agent enrols the PC on
// its first start, sends heartbeats, and gets its kiosk key once an admin approves it
// (engine: pegaprox/api/vlab_enroll.py). Also the 플랫폼 설정 > 클라이언트 section and the portal buttons.

const STATUS: Record<EnrollCodeStatus, { ko: string; en: string; chip: string }> = {
  active: { ko: '사용 중', en: 'Active', chip: 'chip chip-ok' },
  disabled: { ko: '꺼짐', en: 'Off', chip: 'chip' },
  expired: { ko: '만료', en: 'Expired', chip: 'chip' },
  used_up: { ko: '다 씀', en: 'Used up', chip: 'chip chip-warn' },
};
const STALE_MS = 86400e3;

function useL() {
  const { pick, lang } = useI18n();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L: (ko: string, en: string) => pick({ ko, en }), loc, when };
}

function copyText(text: string, done: (ok: boolean) => void) {
  navigator.clipboard?.writeText(text).then(() => done(true), () => done(false));
}

/** No answer from the agent for a day or more. */
export function isStale(x: Terminal) {
  const at = x.enrollment?.last_heartbeat_at ?? x.enrollment?.last_poll_at;
  return !!x.enrollment && x.state !== 'rejected' && !!at && Date.now() - new Date(at).getTime() > STALE_MS;
}

/** 키 전달: has the agent got the kiosk key yet. */
export function KeyDelivery({ terminal }: { terminal: Terminal }) {
  const { L, when } = useL();
  const e = terminal.enrollment;
  if (!e) return <span className="muted small">{terminal.has_key ? L('직접 입력', 'Typed in') : '-'}</span>;
  if (e.state === 'delivered') return <span className="chip chip-ok" title={when(e.delivered_at)}>{L('전달됨', 'Delivered')}</span>;
  if (e.state === 'waiting') {
    return <span className="chip chip-warn">{terminal.state === 'approved' ? L('다음 하트비트에 전달', 'With the next heartbeat') : L('승인 대기', 'Waiting')}</span>;
  }
  if (e.state === 'manual') return <span className="muted small">{L('직접 입력', 'Typed in')}</span>;
  if (e.state === 'rejected') return <span className="muted small">{L('거절됨', 'Refused')}</span>;
  return <span className="muted small">{L('기다리다 만료', 'Wait expired')}</span>;
}

/** 에이전트: online / offline / no answer for a long time, and its version. */
export function AgentStatus({ terminal }: { terminal: Terminal }) {
  const { L, when } = useL();
  const e = terminal.enrollment;
  if (!e) return <span className="muted small">{L('에이전트 없음', 'No agent')}</span>;
  const at = e.last_heartbeat_at ?? e.last_poll_at;
  const chip = terminal.state === 'rejected' ? <span className="chip">{L('끊김', 'Cut off')}</span>
    : e.online ? <span className="chip chip-ok">{L('온라인', 'Online')}</span>
    : isStale(terminal) ? <span className="chip chip-warn">{L('오래 응답 없음', 'Silent for long')}</span>
    : <span className="chip">{L('오프라인', 'Offline')}</span>;
  return (
    <span className="agent-cell" title={`${L('마지막 응답', 'Last heard')} ${when(at)}`}>
      {chip}<span className="muted small">{e.info?.agent_version ? `v${e.info.agent_version}` : ''}</span>
    </span>
  );
}

/** 단말 상세: what the agent told about the PC, and its last heartbeats. */
export function TerminalDetail({ terminal, labName, onClose, onChanged }: { terminal: Terminal; labName: string; onClose: () => void; onChanged: () => void }) {
  const { L, when } = useL();
  const [msg, setMsg] = useState<string | null>(null);
  const e = terminal.enrollment;
  const i = e?.info ?? {};
  async function resend() {
    try { await enrollApi.resendKey(terminal.id); setMsg(L('다음 하트비트(2분 안팎)에 새 키를 보냅니다. 지금 키는 그때까지 씁니다.', 'A new key goes with the next heartbeat (about 2 min); the current one works until then.')); onChanged(); }
    catch (err) { setMsg((err as Error).message); }
  }
  const rows: [string, string][] = [
    [L('컴퓨터 이름', 'Computer name'), i.hostname || terminal.name || '-'],
    ['MAC', i.mac || terminal.mac],
    [L('다른 MAC', 'Other MACs'), (i.macs || '').split(',').filter((m) => m && m !== (i.mac || terminal.mac)).join(', ') || '-'],
    ['IP', i.ip || terminal.ip || '-'],
    ['OS', i.os || '-'],
    [L('클라이언트 · 에이전트', 'Client · agent'), i.client_version ? `${i.client_version} · ${i.agent_version ?? '-'}` : '-'],
    [L('Windows 로그인', 'Signed in to Windows'), i.user_logged_in === undefined ? '-' : i.user_logged_in ? L('있음', 'Yes') : L('없음', 'No')],
    ['LAB', labName],
    [L('등록 요청', 'Requested by'), e?.requested_by || terminal.registered_by || '-'],
    [L('등록 코드', 'Code'), e ? `${e.code}${e.code_kind === 'user' ? L(' (포털 설치 파일)', ' (portal install file)') : ''}` : '-'],
    [L('등록', 'Enrolled'), when(e?.created_at ?? terminal.created_at)],
    [L('마지막 응답', 'Last heard'), when(e?.last_heartbeat_at ?? e?.last_poll_at ?? terminal.last_seen)],
  ];
  return (
    <Dialog open wide title={L(`단말 '${terminal.name || terminal.mac}'`, `Terminal '${terminal.name || terminal.mac}'`)} onClose={onClose} onSubmit={onClose} submitLabel={L('닫기', 'Close')}
      extra={e && terminal.state === 'approved' ? <button type="button" className="btn" onClick={resend}>{L('에이전트로 새 키 보내기', 'Send a new key')}</button> : undefined}>
      <dl className="detail-grid">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        <div><dt>{L('에이전트', 'Agent')}</dt><dd><AgentStatus terminal={terminal} /></dd></div>
        <div><dt>{L('키 전달', 'Key')}</dt><dd><KeyDelivery terminal={terminal} /></dd></div>
      </dl>
      {msg && <div className="alert small info">{msg}</div>}
      {e?.recent?.length ? (
        <>
          <h3 className="panel-title">{L('최근 하트비트', 'Recent heartbeats')}</h3>
          <div className="table-scroll"><table className="table compact-head">
            <thead><tr><th>{L('시각', 'Time')}</th><th>IP</th><th>{L('Windows 로그인', 'Signed in')}</th></tr></thead>
            <tbody>{e.recent.map((r) => <tr key={r.at}><td className="small nowrap">{when(r.at)}</td><td className="small">{r.ip}</td><td className="small">{r.user ? L('있음', 'Yes') : '-'}</td></tr>)}</tbody>
          </table></div>
        </>
      ) : !e && <p className="muted small">{L('에이전트 없이 등록한 단말이라 하트비트 정보가 없습니다.', 'Added without the agent: no heartbeats.')}</p>}
    </Dialog>
  );
}

/** Selected terminals: approve them into a LAB (or move them), or refuse them. */
export function BulkActions({ ids, labs, onDone, onClear }: { ids: string[]; labs: Lab[]; onDone: (msg: string, error?: boolean) => void; onClear: () => void }) {
  const { L } = useL();
  const [lab, setLab] = useState('');
  const [busy, setBusy] = useState(false);
  async function approve() {
    setBusy(true);
    try {
      const r = await enrollApi.approve(ids, lab || null);
      onDone(L(`${r.terminals.length}대를 승인했습니다${lab ? ' (LAB 지정)' : ''}. 에이전트가 다음 하트비트(2분 안팎)에 키오스크 키를 받아 갑니다.`,
        `${r.terminals.length} approved${lab ? ' (LAB set)' : ''}. Their agents pick the kiosk key up with the next heartbeat (about 2 min).`));
    } catch (e) { onDone((e as Error).message, true); } finally { setBusy(false); }
  }
  async function reject() {
    if (!confirm(L(`${ids.length}대를 거절할까요? 그 PC의 에이전트 토큰과 키오스크 키가 끊기고, 단말을 지우기 전에는 다시 등록할 수 없습니다.`,
      `Refuse ${ids.length}? Their agent tokens and kiosk keys stop, and they cannot enrol again until the terminals are deleted.`))) return;
    setBusy(true);
    try { const r = await enrollApi.reject(ids); onDone(L(`${r.terminals.length}대를 거절했습니다.`, `${r.terminals.length} refused.`)); }
    catch (e) { onDone((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="bulk-bar" role="region" aria-label={L('선택한 단말', 'Selected terminals')}>
      <strong>{L(`${ids.length}대 선택`, `${ids.length} selected`)}</strong>
      <select aria-label="LAB" value={lab} onChange={(e) => setLab(e.target.value)}>
        <option value="">{L('LAB 그대로', 'Keep their LAB')}</option>
        {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button type="button" className="btn primary small-btn" disabled={busy} onClick={approve}>{L('한꺼번에 승인', 'Approve all')}</button>
      <button type="button" className="btn-ghost small-btn danger" disabled={busy} onClick={reject}>{L('거절', 'Refuse')}</button>
      <button type="button" className="btn-ghost small-btn" onClick={onClear}>{L('선택 해제', 'Clear')}</button>
    </div>
  );
}

/** 등록 코드: make, see, switch off, delete; the install file and the line for deployment tools. */
export function EnrollCodesPanel({ labs }: { labs: Lab[] }) {
  const { L, loc } = useL();
  const codes = useLoad(enrollApi.codes);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ code: string; row: EnrollCode } | null>(null);
  const [lineOf, setLineOf] = useState<EnrollCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : L('기한 없음', 'No end'));

  async function toggle(c: EnrollCode) {
    try { await enrollApi.update(c.id, { enabled: !c.enabled }); codes.reload(); } catch (e) { setError((e as Error).message); }
  }
  async function remove(c: EnrollCode) {
    if (!confirm(L(`등록 코드 '${c.name}'을(를) 지울까요? 이미 등록한 PC는 그대로 남습니다.`, `Delete enrolment code '${c.name}'? PCs it brought in stay.`))) return;
    try { await enrollApi.remove(c.id); codes.reload(); } catch (e) { setError((e as Error).message); }
  }

  const list = codes.state === 'ok' ? codes.data : [];
  return (
    <section className="panel enroll-panel">
      <div className="panel-head">
        <h3 className="panel-title">{L('등록 코드 · 설치 파일', 'Enrolment codes · install files')}</h3>
        <button type="button" className="btn small-btn" onClick={() => setMaking(true)}><Icon name="plus" size={14} />{L('등록 코드 만들기', 'New code')}</button>
      </div>
      <p className="muted small">{L('등록 코드가 든 설치 파일로 실습실 PC를 등록합니다.', 'Enrol room PCs with an install file that carries a code.')}</p>
      <HowTo><ul>
        <li>{L('함께 깔리는 MOAVI Desk 에이전트(Windows 서비스)가 PC를 켜자마자 승인 대기로 올립니다.', 'The MOAVI Desk Agent (a Windows service) lists the PC, waiting, as soon as it starts.')}</li>
        <li>{L('승인되면 에이전트가 키오스크 키를 스스로 받아 갑니다.', 'Once approved, the agent picks up its kiosk key by itself.')}</li>
        <li>{L('코드 없이는 어떤 PC도 올라오지 않습니다.', 'No PC comes in without a code.')}</li>
        <li>{L('포털 "실습실 PC로 설치"로 받은 파일은 받은 사람 이름의 코드(포털)로 보입니다.', 'Files from the portal’s "Install as a room PC" show as codes in the requester’s name (portal).')}</li>
      </ul></HowTo>
      {error && <div className="alert small error">{error}</div>}
      {codes.state === 'error' && <div className="alert small error">{codes.message}</div>}
      {list.length > 0 && (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{L('이름', 'Name')}</th><th>{L('코드', 'Code')}</th><th>{L('종류', 'Kind')}</th><th>LAB</th><th>{L('승인', 'Approval')}</th><th>{L('사용', 'Used')}</th><th>{L('만료', 'Ends')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.name}</td>
                  <td><code className="code">MDE-…-{c.hint}</code></td>
                  <td className="small">{c.kind === 'user' ? L(`포털 · ${c.created_by}`, `Portal · ${c.created_by}`) : L('관리자', 'Admin')}</td>
                  <td>{c.lab_name ?? <span className="muted">{L('미지정', 'None')}</span>}</td>
                  <td className="small">{c.auto_approve ? L('바로 승인', 'At once') : L('관리자 승인', 'By an admin')}</td>
                  <td className="small nowrap">{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td className="small nowrap">{day(c.expires_at)}</td>
                  <td><span className={STATUS[c.status].chip}>{L(STATUS[c.status].ko, STATUS[c.status].en)}</span></td>
                  <td className="actions">
                    {c.kind !== 'user' && <button type="button" className="btn-ghost small-btn" onClick={() => setLineOf(c)}>{L('설치 명령', 'Install line')}</button>}
                    <button type="button" className="btn-ghost small-btn" onClick={() => toggle(c)}>{c.enabled ? L('끄기', 'Switch off') : L('켜기', 'Switch on')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(c)}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <NewCodeDialog labs={labs} onClose={() => setMaking(false)}
        onMade={(code, row) => { setMaking(false); setMade({ code, row }); codes.reload(); }} />}
      {made && <InstallDialog code={made.code} row={made.row} fresh onClose={() => setMade(null)} />}
      {lineOf && <InstallDialog code={`MDE-XXXX-XXXX-${lineOf.hint}`} row={lineOf} onClose={() => setLineOf(null)} />}
    </section>
  );
}

function NewCodeDialog({ labs, onClose, onMade }: { labs: Lab[]; onClose: () => void; onMade: (code: string, row: EnrollCode) => void }) {
  const { L } = useL();
  const [name, setName] = useState('');
  const [lab, setLab] = useState(labs[0]?.id ?? '');
  const [auto, setAuto] = useState(false);
  const [maxUses, setMaxUses] = useState('40');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await enrollApi.create({ name: name.trim(), lab_id: lab || null, auto_approve: auto, max_uses: Number(maxUses) || 0, days: Number(days) || 0 });
      onMade(r.code, r.enroll_code);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('등록 코드 만들기', 'New enrolment code')} onClose={onClose} onSubmit={submit} submitLabel={L('만들기', 'Create')} busy={busy || !name.trim()} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="enc-name" value={name} maxLength={80} placeholder={L('301호 일괄 설치', 'Room 301 roll-out')} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>LAB</span>
        <select id="enc-lab" value={lab} onChange={(e) => setLab(e.target.value)}>
          <option value="">{L('미지정 (승인할 때 지정)', 'None (pick it on approval)')}</option>
          {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select></label>
      <div className="form-row form-row-even">
        <label><span>{L('PC 수 한도', 'Max PCs')}</span><input id="enc-max" type="number" min={0} max={10000} value={maxUses} placeholder={L('0 = 제한 없음', '0 = any')} onChange={(e) => setMaxUses(e.target.value)} /></label>
        <label><span>{L('유효 기간(일)', 'Valid for (days)')}</span><input id="enc-days" type="number" min={0} max={365} value={days} placeholder={L('0 = 기한 없음', '0 = no end')} onChange={(e) => setDays(e.target.value)} /></label>
      </div>
      <label className="check"><input id="enc-auto" type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>{L('관리자 승인 없이 바로 승인 (코드를 가진 PC를 모두 믿을 때만)', 'Approve at once, no admin review (only when you trust every PC with the code)')}</span></label>
      <small className="muted">{L('코드는 만든 직후 한 번만 보입니다. 설치를 마치면 끄세요.', 'The code shows only once; switch it off after the roll-out.')}</small>
    </Dialog>
  );
}

function InstallDialog({ code, row, fresh, onClose }: { code: string; row: EnrollCode; fresh?: boolean; onClose: () => void }) {
  const { L } = useL();
  const def = serverOfConsole();
  const [host, setHost] = useState(def.host);
  const [port, setPort] = useState(String(def.port));
  const [https, setHttps] = useState(def.https);
  const [kiosk, setKiosk] = useState(true);
  const [password, setPassword] = useState('');
  const [hash, setHash] = useState('');
  const [copied, setCopied] = useState<'code' | 'line' | null>(null);
  const [fileMsg, setFileMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const line = msiexecLine({ host: host.trim() || def.host, port: Number(port) || def.port, https, code, kiosk, passwordHash: kiosk ? hash : '' });

  async function makeHash() { setHash(password ? await kioskPasswordHash(password) : ''); }
  async function download() {
    try { saveFile(await enrollApi.installer(code, kiosk), 'moavi-desk-lab-install.cmd'); setFileMsg({ text: L('설치 파일을 받았습니다.', 'Install file saved.') }); }
    catch (e) { setFileMsg({ text: (e as Error).message, error: true }); }
  }
  return (
    <Dialog open wide title={fresh ? L(`등록 코드 '${row.name}'`, `Enrolment code '${row.name}'`) : L(`'${row.name}' 설치 명령`, `Install line for '${row.name}'`)}
      onClose={onClose} onSubmit={onClose} submitLabel={L('닫기', 'Close')}>
      {fresh ? (
        <>
          <div className="key-box">
            <code id="enroll-code-value">{code}</code>
            <button type="button" className="btn small-btn" onClick={() => copyText(code, (ok) => setCopied(ok ? 'code' : null))}>{copied === 'code' ? L('복사했습니다', 'Copied') : L('복사', 'Copy')}</button>
          </div>
          <div className="alert small">{L('코드는 지금 한 번만 보입니다.', 'The code shows only now.')}</div>
        </>
      ) : <div className="alert small">{L('아래 MDE-XXXX-XXXX를 만들 때 받은 코드로 바꾸세요.', 'Put the code you got when it was made in place of MDE-XXXX-XXXX below.')}</div>}
      <label className="check"><input type="checkbox" checked={kiosk} onChange={(e) => setKiosk(e.target.checked)} />
        <span>{L('키오스크 모드 (전체 화면, 설정 · 종료에 관리자 비밀번호)', 'Kiosk mode (full screen, admin password for settings and exit)')}</span></label>
      {fresh && (
        <section className="install-way">
          <h4>{L('1. 설치 파일 (더블클릭)', '1. Install file (double-click)')}</h4>
          <p className="muted small">{L('PC에서 실행하면 MSI를 받아 조용히 설치합니다.', 'Run on a PC, it fetches the MSI and installs it silently.')}</p>
          <HowTo><ul>
            <li>{L('관리자 권한을 한 번 묻습니다.', 'It asks for elevation once.')}</li>
            <li>{L('MSI를 HTTPS로 받아 SHA-256을 확인합니다.', 'It fetches the MSI over HTTPS and checks its SHA-256.')}</li>
            <li>{L('MSI는 플랫폼 설정 > 클라이언트에 올린 것을 씁니다.', 'It uses the MSI under 플랫폼 설정 > 클라이언트.')}</li>
          </ul></HowTo>
          <button type="button" className="btn small-btn" onClick={download}><Icon name="download" size={14} />{L('이 코드로 설치 파일 받기', 'Download an install file with this code')}</button>
          {fileMsg && <span className={`small ${fileMsg.error ? 'danger-text' : 'muted'}`}> {fileMsg.text}</span>}
          <div className="alert small warn">{L('이 파일(또는 코드)이 있으면 누구나 PC 등록을 요청할 수 있습니다. 필요한 사람에게만 주고, 끝나면 코드를 끄세요.',
            'Anyone with this file (or the code) can ask to enrol a PC. Hand it out only where needed and switch the code off afterwards.')}</div>
        </section>
      )}
      <section className="install-way">
        <h4>{L(fresh ? '2. 명령 줄 · 배포 도구 (GPO · SCCM · Intune · PDQ)' : '명령 줄 · 배포 도구 (GPO · SCCM · Intune · PDQ)', 'Command line · deployment tools (GPO, SCCM, Intune, PDQ)')}</h4>
        <div className="form-row form-row-even">
          <label><span>{L('PC가 접속할 서버 주소', 'Server address the PCs reach')}</span><input id="enc-host" value={host} onChange={(e) => setHost(e.target.value)} /></label>
          <label><span>{L('포트', 'Port')}</span><input id="enc-port" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={https} onChange={(e) => setHttps(e.target.checked)} /><span>HTTPS</span></label>
        {kiosk && (
          <div className="form-row">
            <label><span>{L('키오스크 관리자 비밀번호 (선택)', 'Kiosk admin password (optional)')}</span>
              <input id="enc-kpass" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setHash(''); }} /></label>
            <button type="button" className="btn small-btn" disabled={!password} onClick={makeHash}>{L('명령에 넣기', 'Add to the line')}</button>
          </div>
        )}
        {kiosk && hash && <small className="muted">{L('비밀번호는 이 브라우저에서 해시로만 바뀌어 명령에 들어갑니다(서버로 보내지 않음).', 'The password becomes a hash in this browser only; it is not sent to the server.')}</small>}
        <div className="key-box install-line">
          <code id="enroll-msiexec">{line}</code>
          <button type="button" className="btn small-btn" onClick={() => copyText(line, (ok) => setCopied(ok ? 'line' : null))}>{copied === 'line' ? L('복사했습니다', 'Copied') : L('복사', 'Copy')}</button>
        </div>
        <HowTo><ul>
          <li>{L('MSI 파일 이름은 받은 파일에 맞게 바꾸세요.', 'Use the MSI’s real file name.')}</li>
          <li>{L('MSI 옆에 moavi-desk-enroll.json(server, port, https, enroll_code, kiosk)을 두고 더블클릭해도 됩니다.', 'Or put moavi-desk-enroll.json (server, port, https, enroll_code, kiosk) next to the MSI and double-click it.')}</li>
          <li>{L('명령 줄 값이 파일보다 앞섭니다.', 'The command line wins over the file.')}</li>
          <li>{L('방화벽은 단말 → 서버 443(HTTPS)만 열면 됩니다.', 'Firewall: only terminal → server 443 (HTTPS).')}</li>
          <li>{L('승인되면 2분 안팎에 "키 전달" 열이 전달됨으로 바뀝니다.', 'Once approved, the Key column turns to Delivered within about 2 minutes.')}</li>
        </ul></HowTo>
      </section>
    </Dialog>
  );
}

// --- 운영 > 플랫폼 설정 > 클라이언트: 실습실 PC 설치 -------------------------------------------

export function TerminalInstallPanel() {
  const data = useLoad(enrollApi.settings);
  const roles = useLoad(usersApi.roles);
  return (
    <LoadState value={data} retry={data.reload}>
      {(s) => <InstallForm initial={s} roles={roles.state === 'ok' ? roles.data.map((r) => ({ id: r.id, name: r.name })) : []} onSaved={data.reload} />}
    </LoadState>
  );
}

function InstallForm({ initial, roles, onSaved }: { initial: InstallSettings; roles: { id: string; name: string }[]; onSaved: () => void }) {
  const { L, when } = useL();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const roleList = roles.length ? roles : [{ id: 'admin', name: 'admin' }, { id: 'user', name: 'user' }];
  const toggle = (k: 'lab_install_roles' | 'auto_approve_roles', id: string, on: boolean) =>
    setV({ ...v, [k]: on ? [...v[k], id] : v[k].filter((x) => x !== id) });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { msi: _m, msi_ready: _r, pending: _p, ...body } = v;
      const s = await enrollApi.saveSettings(body);
      setV({ ...v, ...s }); setMsg({ text: L('저장했습니다.', 'Saved.') }); onSaved();
    } catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg(null);
    try { const msi = await enrollApi.uploadMsi(file); setV({ ...v, msi, msi_ready: true }); setMsg({ text: L('MSI를 올렸습니다.', 'MSI uploaded.') }); }
    catch (e) { setMsg({ text: (e as Error).message, error: true }); } finally { setBusy(false); }
  }
  async function removeMsi() {
    if (!confirm(L('올린 MSI를 지울까요? 설치 파일을 더 만들 수 없게 됩니다.', 'Remove the uploaded MSI? No more install files can be made.'))) return;
    try { await enrollApi.deleteMsi(); setV({ ...v, msi: null, msi_ready: false }); } catch (e) { setMsg({ text: (e as Error).message, error: true }); }
  }
  const num = (k: 'token_hours' | 'max_uses' | 'user_active_tokens' | 'pending_warn', label: string) => (
    <label><span>{label}</span><input id={`ti-${k}`} type="number" min={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) || 1 })} /></label>
  );
  return (
    <section className="panel settings-narrow">
      <h3 className="panel-title">{L('실습실 PC 설치 (단말 등록)', 'Room PC install (terminal enrolment)')}</h3>
      <p className="muted small">{L('실습실 PC 설치 파일과 포털의 설치 링크를 설정합니다.', 'Room PC install files and the portal’s install link.')}</p>
      <HowTo><ul>
        <li>{L('설치 파일은 이 서버에 올린 MSI를 받아 설치합니다(SHA-256 확인).', 'Install files fetch the MSI uploaded here (SHA-256 checked).')}</li>
        <li>{L('포털 링크를 켜면 정한 역할(조교, 현장 담당자 등)이 실습실 PC에서 [실습실 PC로 설치]를 누릅니다.', 'With the portal link on, the chosen roles (TAs, local staff) click [Install as a room PC] on a room PC.')}</li>
        <li>{L('그 PC는 단말 관리에 승인 대기로 올라오고, 관리자가 승인합니다.', 'The PC shows up under 단말 관리, waiting for an admin.')}</li>
      </ul></HowTo>

      <h4>{L('클라이언트 MSI', 'Client MSI')}</h4>
      {v.msi ? (
        <p className="small">{v.msi.name} · {(v.msi.size / 1048576).toFixed(1)} MB · {when(v.msi.uploaded_at)}<br /><code className="code muted small">SHA-256 {v.msi.sha256}</code></p>
      ) : <div className="alert small warn">{L('MSI가 없습니다. MOAVI-Desk-<버전>-x64.msi를 올려야 설치 파일을 만들 수 있습니다.', 'No MSI yet: upload MOAVI-Desk-<version>-x64.msi to make install files.')}</div>}
      <div className="toolbar">
        <label className="btn small-btn"><Icon name="plus" size={14} />{v.msi ? L('새 MSI 올리기', 'Upload a new MSI') : L('MSI 올리기', 'Upload the MSI')}
          <input type="file" accept=".msi" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>
        {v.msi && <button type="button" className="btn-ghost small-btn danger" onClick={removeMsi}>{L('지우기', 'Remove')}</button>}
      </div>
      <small className="muted">{L('서버 이중화를 쓰면 대기 서버에도 따로 올려 두세요(MSI 파일은 동기화하지 않음).', 'With a server pair, upload it on the standby too (the MSI file is not synced).')}</small>

      <h4>{L('포털의 "실습실 PC로 설치"', 'The portal’s "Install as a room PC"')}</h4>
      <label className="check"><input id="ti-enabled" type="checkbox" checked={v.lab_install_enabled} onChange={(e) => setV({ ...v, lab_install_enabled: e.target.checked })} />
        <span>{L('포털 상단에 링크를 보임', 'Show the link at the top of the portal')}</span></label>
      <fieldset className="plain" disabled={!v.lab_install_enabled}>
        <span className="small strong">{L('볼 수 있는 역할', 'Roles that see it')}</span>
        <div className="role-checks">{roleList.map((r) => (
          <label key={r.id} className="check"><input type="checkbox" checked={v.lab_install_roles.includes(r.id)} onChange={(e) => toggle('lab_install_roles', r.id, e.target.checked)} /><span>{r.name}</span></label>
        ))}</div>
        <div className="form-row form-row-even">
          {num('token_hours', L('파일 유효 시간(시간)', 'File valid for (hours)'))}
          {num('max_uses', L('파일 하나로 등록할 수 있는 PC 수 상한', 'Most PCs per file'))}
        </div>
        <div className="form-row form-row-even">
          {num('user_active_tokens', L('사용자당 동시에 쓸 수 있는 파일 수', 'Unused files per user'))}
          {num('pending_warn', L('승인 대기 경고 기준(대)', 'Warn past this many waiting'))}
        </div>
      </fieldset>
      <span className="small strong">{L('자동 승인할 역할 (기본: 없음)', 'Roles approved at once (default: none)')}</span>
      <div className="role-checks">{roleList.map((r) => (
        <label key={r.id} className="check"><input type="checkbox" checked={v.auto_approve_roles.includes(r.id)} onChange={(e) => toggle('auto_approve_roles', r.id, e.target.checked)} /><span>{r.name}</span></label>
      ))}</div>
      <small className="muted">{L('이 역할이 포털에서 받은 파일로 등록한 PC는 바로 승인됩니다. 관리자 파일도 관리자 역할을 켜야 자동 승인됩니다.',
        'PCs enrolled with a portal file of these roles are approved at once. An admin’s own files too, only with the admin role ticked.')}</small>

      <h4>{L('설치 파일에 넣을 값', 'What install files carry')}</h4>
      <label className="check"><input id="ti-kiosk" type="checkbox" checked={v.kiosk} onChange={(e) => setV({ ...v, kiosk: e.target.checked })} /><span>{L('키오스크 모드로 설치', 'Install in kiosk mode')}</span></label>
      <label><span>{L('PC가 접속할 서버 주소 (비우면 이 화면의 주소)', 'Server address the PCs reach (empty = this page’s)')}</span>
        <input id="ti-url" value={v.server_url} placeholder="https://desk.example.com" onChange={(e) => setV({ ...v, server_url: e.target.value.trim() })} /></label>
      <label><span>{L('사설 인증서 지문 SHA-256 (선택)', 'Private certificate SHA-256 (optional)')}</span>
        <input id="ti-pin" value={v.server_cert_sha256} placeholder="AB12…(64)" onChange={(e) => setV({ ...v, server_cert_sha256: e.target.value.trim() })} /></label>
      <small className="muted">{L('공인 인증서면 비워 두세요. 넣으면 에이전트 · 클라이언트 · 설치 파일이 그 인증서만 믿습니다.', 'Leave empty with a public certificate. Set, the agent, client and install files trust that certificate only.')}</small>
      {msg && <div className={`alert small ${msg.error ? 'error' : 'info'}`}>{msg.text}</div>}
      <div className="toolbar"><button type="button" className="btn primary" disabled={busy} onClick={save}>{L('저장', 'Save')}</button></div>
    </section>
  );
}

// --- the portal: the two install buttons ----------------------------------------------------

/** "MOAVI Desk Client 받기" (personal PC, the server filled in) and, when allowed, "실습실 PC로 설치". */
export function PortalInstallButtons({ fallbackHref, version, label, title }: { fallbackHref: string; version?: string; label: string; title: string }) {
  const { L } = useL();
  const info = useLoad(enrollApi.labInstallInfo);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const i = info.state === 'ok' ? info.data : null;
  const labOn = useFeatures().on('lab');
  async function personal() {
    try { saveFile(await enrollApi.personalInstaller(), 'moavi-desk-install.cmd'); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <>
      {i?.personal_installer ? (
        <button type="button" className="btn-ghost" title={L('개인 PC용: 서버 주소가 들어간 설치 파일을 받습니다(단말로 등록하지 않음).', 'For a personal PC: an install file with the server filled in (no terminal enrolment).')} onClick={personal}>
          <Icon name="download" size={16} />{label}{version && <span className="tag-soft tag">v{version}</span>}
        </button>
      ) : (
        <a className="btn-ghost" href={fallbackHref} target="_blank" rel="noopener noreferrer" title={title}>
          <Icon name="download" size={16} />{label}{version && <span className="tag-soft tag">v{version}</span>}
        </a>
      )}
      {i?.allowed && labOn && (
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)}><Icon name="lab" size={16} />{L('실습실 PC로 설치', 'Install as a room PC')}</button>
      )}
      {err && <span className="small danger-text">{err}</span>}
      {open && i && <LabInstallDialog info={i} onClose={() => setOpen(false)} />}
    </>
  );
}

function LabInstallDialog({ info, onClose }: { info: NonNullable<Awaited<ReturnType<typeof enrollApi.labInstallInfo>>>; onClose: () => void }) {
  const { L } = useL();
  const [lab, setLab] = useState('');
  const [uses, setUses] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit() {
    if (done) { onClose(); return; }
    setBusy(true); setError(null);
    try { saveFile(await enrollApi.labInstallFile(lab || null, Math.max(1, Number(uses) || 1)), 'moavi-desk-lab-install.cmd'); setDone(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('실습실 PC로 설치', 'Install as a room PC')} onClose={onClose} onSubmit={submit}
      submitLabel={done ? L('닫기', 'Close') : L('설치 파일 받기', 'Download the install file')} busy={busy || (!done && !info.msi_ready)} error={error}>
      {!info.msi_ready && <div className="alert small warn">{L('관리자가 아직 설치 파일(MSI)을 서버에 올리지 않았습니다.', 'The administrator has not put the client MSI on the server yet.')}</div>}
      <p className="muted small">{L('이 PC에서 파일을 실행하면 MOAVI Desk가 깔리고 관리자 승인을 기다립니다.', 'Run the file on this PC: it installs MOAVI Desk and waits for an administrator.')}</p>
      <label><span>LAB</span>
        <select id="li-lab" value={lab} onChange={(e) => setLab(e.target.value)} disabled={done}>
          <option value="">{L('모름 (관리자가 지정)', 'Not sure (the admin picks)')}</option>
          {info.labs.map((l) => <option key={l.id} value={l.id}>{l.name}{l.location ? ` · ${l.location}` : ''}</option>)}
        </select></label>
      <label><span>{L(`이 파일로 설치할 PC 수 (최대 ${info.max_uses}대)`, `PCs this file installs (up to ${info.max_uses})`)}</span>
        <input id="li-uses" type="number" min={1} max={info.max_uses} value={uses} disabled={done} onChange={(e) => setUses(e.target.value)} /></label>
      <small className="muted">{L(`파일은 ${info.hours}시간 동안 쓸 수 있습니다. ${info.auto_approve ? '이 계정으로 받은 파일은 바로 승인됩니다.' : '관리자가 승인해야 쓸 수 있습니다.'} 다른 사람에게 주지 마세요.`,
        `The file works for ${info.hours} hours. ${info.auto_approve ? 'Files of this account are approved at once.' : 'An administrator approves the PCs.'} Keep it to yourself.`)}</small>
      {done && <div className="alert small info">{L('받았습니다. 파일(moavi-desk-lab-install.cmd)을 실행하세요. 끝나면 관리자 승인을 기다립니다.', 'Saved. Run moavi-desk-lab-install.cmd; then the PC waits for approval.')}</div>}
    </Dialog>
  );
}

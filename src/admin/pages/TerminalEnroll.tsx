import { useState } from 'react';
import { enrollApi, kioskPasswordHash, msiexecLine, serverOfConsole, type EnrollCode, type EnrollCodeStatus } from '../../api/enroll';
import type { Lab, Terminal } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// LAB > 단말 관리: installing MOAVI Desk Client on a room's PCs at once. An enrolment code goes into
// the MSI (msiexec ... ENROLL_CODE=...); every PC enrols on its first start and gets its kiosk key on
// the first poll after an admin approves it (engine: pegaprox/api/vlab_enroll.py).

const STATUS: Record<EnrollCodeStatus, { ko: string; en: string; chip: string }> = {
  active: { ko: '사용 중', en: 'Active', chip: 'chip chip-ok' },
  disabled: { ko: '꺼짐', en: 'Off', chip: 'chip' },
  expired: { ko: '만료', en: 'Expired', chip: 'chip' },
  used_up: { ko: '다 씀', en: 'Used up', chip: 'chip chip-warn' },
};

function useL() {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), loc: lang === 'ko' ? 'ko-KR' : 'en-US' };
}

function copyText(text: string, done: (ok: boolean) => void) {
  navigator.clipboard?.writeText(text).then(() => done(true), () => done(false));
}

/** 키 전달: has the enrolled client got its key yet. */
export function KeyDelivery({ terminal }: { terminal: Terminal }) {
  const { L, loc } = useL();
  const e = terminal.enrollment;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  if (!e) return <span className="muted small">{terminal.has_key ? L('직접 입력', 'Typed in') : '-'}</span>;
  if (e.state === 'delivered') return <span className="chip chip-ok" title={`${e.code} · ${when(e.delivered_at)}`}>{L('전달됨', 'Delivered')}</span>;
  if (e.state === 'waiting') {
    return (
      <span className="chip chip-warn" title={`${e.code}${e.last_poll_at ? ` · ${L('마지막 확인', 'last asked')} ${when(e.last_poll_at)}` : ''}`}>
        {terminal.state === 'approved' ? L('다음 확인 때 전달', 'On its next poll') : L('대기', 'Waiting')}</span>
    );
  }
  if (e.state === 'manual') return <span className="muted small">{L('직접 입력', 'Typed in')}</span>;
  return <span className="muted small">{L('기다리다 만료', 'Wait expired')}</span>;
}

/** Selected pending terminals: approve them all, into a LAB. */
export function BulkApprove({ ids, labs, onDone, onClear }: { ids: string[]; labs: Lab[]; onDone: (msg: string, error?: boolean) => void; onClear: () => void }) {
  const { L } = useL();
  const [lab, setLab] = useState('');
  const [busy, setBusy] = useState(false);
  async function approve() {
    setBusy(true);
    try {
      const r = await enrollApi.approve(ids, lab || null);
      onDone(L(`${r.terminals.length}대를 승인했습니다. 등록 코드로 설치한 PC는 다음 확인 때(30초 안팎) 키를 받아 갑니다.`,
        `${r.terminals.length} approved. PCs installed with a code pick their key up on their next poll (about 30 s).`));
    } catch (e) { onDone((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="bulk-bar" role="region" aria-label={L('선택한 단말', 'Selected terminals')}>
      <strong>{L(`${ids.length}대 선택`, `${ids.length} selected`)}</strong>
      <select aria-label="LAB" value={lab} onChange={(e) => setLab(e.target.value)}>
        <option value="">{L('LAB 그대로', 'Keep their LAB')}</option>
        {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button type="button" className="btn primary small-btn" disabled={busy} onClick={approve}>{L('한꺼번에 승인', 'Approve all')}</button>
      <button type="button" className="btn-ghost small-btn" onClick={onClear}>{L('선택 해제', 'Clear')}</button>
    </div>
  );
}

/** 등록 코드: make, see, switch off, delete; the install line to copy. */
export function EnrollCodesPanel({ labs }: { labs: Lab[] }) {
  const { L, loc } = useL();
  const codes = useLoad(enrollApi.codes);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ code: string; row: EnrollCode } | null>(null);
  const [lineOf, setLineOf] = useState<EnrollCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(loc) : L('기한 없음', 'No end'));

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
        <h3 className="panel-title">{L('등록 코드 · 무인 설치', 'Enrolment codes · unattended install')}</h3>
        <button type="button" className="btn small-btn" onClick={() => setMaking(true)}><Icon name="plus" size={14} />{L('등록 코드 만들기', 'New code')}</button>
      </div>
      <p className="muted small">{L('코드를 넣은 MSI로 실습실 PC에 한꺼번에 설치하면, PC가 처음 켜질 때 스스로 이 목록에 등록되고 승인되는 대로 키오스크 키를 받아 갑니다. 단말마다 키를 손으로 넣을 필요가 없습니다.',
        'Install the MSI with a code on a room’s PCs at once: each PC enrols itself on its first start and picks up its kiosk key once approved. No key to type in on each PC.')}</p>
      {error && <div className="alert small error">{error}</div>}
      {codes.state === 'error' && <div className="alert small error">{codes.message}</div>}
      {list.length > 0 && (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{L('이름', 'Name')}</th><th>{L('코드', 'Code')}</th><th>LAB</th><th>{L('승인', 'Approval')}</th><th>{L('사용', 'Used')}</th><th>{L('만료', 'Ends')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.name}</td>
                  <td><code className="code">MDE-…-{c.hint}</code></td>
                  <td>{c.lab_name ?? <span className="muted">{L('미지정', 'None')}</span>}</td>
                  <td className="small">{c.auto_approve ? L('바로 승인', 'At once') : L('관리자 승인', 'By an admin')}</td>
                  <td className="small nowrap">{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td className="small nowrap">{day(c.expires_at)}</td>
                  <td><span className={STATUS[c.status].chip}>{L(STATUS[c.status].ko, STATUS[c.status].en)}</span></td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" onClick={() => setLineOf(c)}>{L('설치 명령', 'Install line')}</button>
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
      {made && <InstallLineDialog code={made.code} row={made.row} fresh onClose={() => setMade(null)} />}
      {lineOf && <InstallLineDialog code={`MDE-XXXX-XXXX-${lineOf.hint}`} row={lineOf} onClose={() => setLineOf(null)} />}
    </section>
  );
}

function NewCodeDialog({ labs, onClose, onMade }: { labs: Lab[]; onClose: () => void; onMade: (code: string, row: EnrollCode) => void }) {
  const { L } = useL();
  const [name, setName] = useState('');
  const [lab, setLab] = useState(labs[0]?.id ?? '');
  const [auto, setAuto] = useState(false);
  const [maxUses, setMaxUses] = useState('');
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
        <span>{L('관리자 승인 없이 바로 승인 (코드를 가진 PC를 믿을 때만)', 'Approve at once, no admin review (only when you trust every PC with the code)')}</span></label>
      <small className="muted">{L('코드는 만든 직후 한 번만 보입니다. 설치를 마치면 끄거나, PC 수 한도 · 기한을 짧게 두세요. 잘못된 코드는 같은 주소에서 몇 번 틀리면 잠시 막힙니다.',
        'The code shows only once. Switch it off after the roll-out or keep the PC limit and validity short. Wrong codes from one address are blocked for a while after a few tries.')}</small>
    </Dialog>
  );
}

function InstallLineDialog({ code, row, fresh, onClose }: { code: string; row: EnrollCode; fresh?: boolean; onClose: () => void }) {
  const { L } = useL();
  const def = serverOfConsole();
  const [host, setHost] = useState(def.host);
  const [port, setPort] = useState(String(def.port));
  const [https, setHttps] = useState(def.https);
  const [kiosk, setKiosk] = useState(true);
  const [password, setPassword] = useState('');
  const [hash, setHash] = useState('');
  const [copied, setCopied] = useState<'code' | 'line' | null>(null);
  const line = msiexecLine({ host: host.trim() || def.host, port: Number(port) || def.port, https, code, kiosk, passwordHash: kiosk ? hash : '' });

  async function makeHash() {
    setHash(password ? await kioskPasswordHash(password) : '');
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
          <div className="alert small">{L('코드는 지금 한 번만 보입니다. 아래 설치 명령과 함께 보관하세요.', 'The code shows only now. Keep it with the install line below.')}</div>
        </>
      ) : <div className="alert small">{L('코드 전체는 만들 때 한 번만 보였습니다. 아래 줄의 MDE-XXXX-XXXX 부분을 그때 받은 코드로 바꾸세요.', 'The full code showed only when it was made; put it in place of MDE-XXXX-XXXX below.')}</div>}
      <div className="form-row form-row-even">
        <label><span>{L('PC가 접속할 서버 주소', 'Server address the PCs reach')}</span><input id="enc-host" value={host} onChange={(e) => setHost(e.target.value)} /></label>
        <label><span>{L('포트', 'Port')}</span><input id="enc-port" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={https} onChange={(e) => setHttps(e.target.checked)} /><span>HTTPS</span></label>
      <label className="check"><input type="checkbox" checked={kiosk} onChange={(e) => setKiosk(e.target.checked)} />
        <span>{L('키오스크 모드 (전체 화면, 설정 · 종료에 관리자 비밀번호)', 'Kiosk mode (full screen, admin password for settings and exit)')}</span></label>
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
      <ol className="key-steps small">
        <li>{L('관리자 권한 명령 프롬프트, GPO 시작 스크립트 또는 배포 도구(SCCM · Intune 등)로 각 PC에서 위 줄을 실행합니다. MSI 파일 이름은 받은 파일에 맞게 바꿉니다.',
          'Run the line on each PC from an elevated prompt, a GPO startup script or your deployment tool (SCCM, Intune …). Use the MSI’s actual file name.')}</li>
        <li>{L('PC가 MOAVI Desk를 처음 켜면 이 화면 단말 목록에 나타납니다' + (row.auto_approve ? ' (바로 승인).' : '. 승인 대기를 골라 한꺼번에 승인하세요.'),
          'When MOAVI Desk first starts on a PC it shows up in the list below' + (row.auto_approve ? ' (approved at once).' : '; select the waiting ones and approve them at once.'))}</li>
        <li>{L('승인되면 PC가 30초 안팎에 키오스크 키를 받아 갑니다. "키 전달" 열이 전달됨으로 바뀝니다.', 'Once approved a PC picks its kiosk key up within about 30 s; the Key column turns to Delivered.')}</li>
      </ol>
    </Dialog>
  );
}

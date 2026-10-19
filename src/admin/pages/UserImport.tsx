import { useState } from 'react';
import { accountsApi, downloadText, EXAMPLE_CSV, type ImportResult, type ImportRow } from '../../api/accounts';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';

// 사용자 목록 > 일괄 등록: a CSV (아이디, 이름, 메일, 부서, 역할, 사용 기한) -> preview with the
// errors and duplicates -> the good rows become accounts with a random password that must be
// changed at the first sign-in. The passwords come back once, in the result CSV, or go to each
// person by mail (makus-vlab pegaprox/api/vlab_accounts.py).

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}

const ERR_KO: [RegExp, string][] = [
  [/^exists$/, '이미 있는 아이디'], [/^duplicate of line (\d+)$/, '$1번째 줄과 중복'], [/^username:.*$/, '아이디 형식(소문자 · 숫자 · . _ - 3~32자)'],
  [/^email is not valid$/, '메일 형식 오류'], [/^department: no department named "(.*)"$/, '부서 "$1" 없음'],
  [/^department: more than one department named "(.*)"$/, '같은 이름의 부서 "$1"가 여럿'], [/^role: admin.*$/, '관리자 계정은 하나씩 만듭니다'],
  [/^role: no such role "(.*)"$/, '역할 "$1" 없음'], [/^role: "(.*)" grants more.*$/, '역할 "$1"은 내 권한보다 큼'],
  [/^expires_at: the day has passed$/, '사용 기한이 지난 날짜'], [/^expires_at:.*$/, '사용 기한은 YYYY-MM-DD'],
];

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { lang } = useI18n();
  const L = useL();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [deliver, setDeliver] = useState<'csv' | 'mail'>('csv');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saved, setSaved] = useState(false);
  const err = (e: string) => (lang === 'ko' ? ERR_KO.reduce((s, [re, ko]) => (re.test(s) ? s.replace(re, ko) : s), e) : e);

  async function pick(f: File | undefined) {
    if (!f) return;
    const buf = await f.arrayBuffer();
    // a spreadsheet saves CSV as UTF-8 or, in Korean Windows, CP949
    let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (t.includes('�')) { try { t = new TextDecoder('euc-kr').decode(buf); } catch { /* keep utf-8 */ } }
    setText(t); setFileName(f.name); setRows(null); setError(null);
  }
  async function preview() {
    setBusy(true); setError(null);
    try { setRows((await accountsApi.importPreview(text)).rows); } catch (e) { setError((e as Error).message); setRows(null); } finally { setBusy(false); }
  }
  async function run() {
    setBusy(true); setError(null);
    try { setResult(await accountsApi.importAccounts(text, deliver, mustChange)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const good = rows?.filter((r) => !r.errors.length).length ?? 0;
  const bad = (rows?.length ?? 0) - good;
  const stamp = new Date().toISOString().slice(0, 10);

  const finish = () => onDone(L(`${result?.created.length ?? 0}개 계정을 만들었습니다.`, `${result?.created.length ?? 0} account(s) made.`));
  if (result) {
    const withPw = result.csv.split(/\r?\n/).slice(1).filter((l) => l && !l.endsWith(',yes')).length;
    return (
      <Dialog open wide title={L('일괄 등록 결과', 'Import result')} onClose={finish} onSubmit={finish} submitLabel={L('닫기', 'Close')}>
        <div className="alert info small" role="status">
          {L(`${result.created.length}개 만듦 · ${result.skipped.length}개 건너뜀` + (result.mailed ? ` · ${result.mailed}명에게 메일 보냄` : ''),
            `${result.created.length} made · ${result.skipped.length} skipped` + (result.mailed ? ` · ${result.mailed} mailed` : ''))}
        </div>
        {withPw > 0 && (
          <div className={`alert small ${saved ? 'info' : 'error'}`}>
            {L(`결과 CSV에 초기 비밀번호 ${withPw}개가 있습니다. 창을 닫으면 다시 받을 수 없으니 안전하게 보관하세요.`,
              `The result CSV holds ${withPw} initial password(s) and cannot be downloaded again once this closes. Keep it safe.`)}
          </div>)}
        <div className="toolbar">
          <button type="button" className="btn primary" onClick={() => { downloadText(`accounts-${stamp}.csv`, result.csv); setSaved(true); }}>
            <Icon name="download" size={16} />{L('결과 CSV 받기', 'Download the result CSV')}</button>
        </div>
        {result.skipped.length > 0 && (
          <div className="table-scroll"><table className="table compact-head">
            <thead><tr><th>{L('줄', 'Line')}</th><th>{L('아이디', 'Username')}</th><th>{L('건너뛴 이유', 'Why skipped')}</th></tr></thead>
            <tbody>{result.skipped.map((s) => <tr key={s.line}><td className="num">{s.line}</td><td>{s.username || '-'}</td><td className="small">{s.errors.map(err).join(' · ')}</td></tr>)}</tbody>
          </table></div>)}
      </Dialog>
    );
  }

  return (
    <Dialog open wide title={L('계정 일괄 등록', 'Import accounts')} onClose={onClose} onSubmit={rows ? run : preview}
      submitLabel={rows ? L(`${good}개 만들기`, `Make ${good}`) : L('미리 보기', 'Preview')} busy={busy || !text.trim() || (!!rows && good === 0)} error={error}
      extra={rows ? <button type="button" className="btn" onClick={() => setRows(null)}>{L('다시 고르기', 'Back')}</button> : undefined}>
      {!rows ? (
        <>
          <p className="muted small">{L('CSV로 계정을 한 번에 1000명까지 만듭니다.',
            'Make up to 1000 accounts at once from a CSV.')}</p>
          <HowTo label={L('CSV 형식', 'CSV format')}><ul>
            <li>{L('첫 줄 열 이름: 아이디, 이름, 메일, 부서, 역할, 사용 기한(YYYY-MM-DD)', 'First row: username, name, mail, department, role, last day (YYYY-MM-DD)')}</li>
            <li>{L('아이디만 필수이고, 역할을 비우면 사용자입니다.', 'Only username is needed; an empty role is user.')}</li>
            <li>{L('부서는 이름이나 ID로 씁니다.', 'A department by name or id.')}</li>
          </ul></HowTo>
          <div className="toolbar">
            <label className="btn"><Icon name="plus" size={16} />{L('CSV 파일 고르기', 'Choose a CSV file')}
              <input id="imp-file" type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
            <button type="button" className="btn-ghost" onClick={() => downloadText('accounts-example.csv', EXAMPLE_CSV)}><Icon name="download" size={16} />{L('예제 CSV 받기', 'Example CSV')}</button>
            {fileName && <span className="muted small">{fileName}</span>}
          </div>
          <label><span>{L('또는 붙여 넣기', 'Or paste')}</span>
            <textarea id="imp-text" rows={8} spellCheck={false} value={text} placeholder={EXAMPLE_CSV} onChange={(e) => { setText(e.target.value); setFileName(''); }} /></label>
        </>
      ) : (
        <>
          <div className={`alert small ${bad ? 'error' : 'info'}`}>{L(`만들 수 있는 계정 ${good}개 · 오류 · 중복 ${bad}개 (오류가 있는 줄은 건너뜁니다)`,
            `${good} ready · ${bad} with errors or duplicates (those rows are skipped)`)}</div>
          <div className="table-scroll import-preview"><table className="table compact-head">
            <thead><tr><th>{L('줄', 'Line')}</th><th>{L('아이디', 'Username')}</th><th>{L('이름', 'Name')}</th><th>{L('메일', 'Mail')}</th><th>{L('부서', 'Department')}</th><th>{L('역할', 'Role')}</th><th>{L('사용 기한', 'Last day')}</th><th>{L('확인', 'Check')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.line} className={r.errors.length ? 'row-error' : ''}>
                <td className="num">{r.line}</td><td className="strong">{r.username || '-'}</td><td>{r.display_name}</td><td className="small">{r.email || '-'}</td>
                <td>{r.department || '-'}</td><td>{r.role}</td><td>{r.expires_at ?? '-'}</td>
                <td className="small">{r.errors.length ? <span className={`chip ${r.duplicate ? 'chip-warn' : 'chip-off'}`}>{r.errors.map(err).join(' · ')}</span> : <span className="chip chip-on">OK</span>}</td>
              </tr>))}</tbody>
          </table></div>
          <fieldset className="check-list">
            <legend>{L('초기 비밀번호 전달', 'Initial passwords')}</legend>
            <label className="check"><input type="radio" name="imp-deliver" checked={deliver === 'csv'} onChange={() => setDeliver('csv')} />
              <span>{L('결과 CSV로 받기 (비밀번호가 들어 있고 한 번만 받을 수 있음)', 'In the result CSV (with the passwords, downloadable once)')}</span></label>
            <label className="check"><input type="radio" name="imp-deliver" checked={deliver === 'mail'} onChange={() => setDeliver('mail')} />
              <span>{L('각자 메일로 안내 (메일이 없는 계정만 결과 CSV에 비밀번호)', 'Mail each person (the CSV keeps passwords only for those without mail)')}</span></label>
            <label className="check"><input id="imp-must" type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
              <span>{L('다음 로그인 때 비밀번호 변경', 'Change the password at next sign-in')}</span></label>
          </fieldset>
        </>
      )}
    </Dialog>
  );
}

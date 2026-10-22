import { useState } from 'react';
import {
  MCP_CERT_URL, MCP_CLIENTS, MCP_MCPB_URL, MCP_MODEL_AT, mcpApi, mcpSnippet,
  type McpClient, type McpReauth, type McpReauthNeed, type McpScope, type McpState, type McpToken,
} from '../../api/mcp';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정 › MCP 연동: Claude Desktop, Claude Code, Gemini CLI, Codex CLI or a local LLM app on the admin's PC
// manages VMs through the engine's MCP server at its internal address, with a token per person and per client.

const CLIENT_NAME: Record<McpClient, string> = {
  desktop: 'Claude Desktop', claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex CLI', local: '로컬 LLM', stdio: 'stdio',
};

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when };
}

export function McpPage() {
  const { L, when } = useL();
  const data = useLoad(mcpApi.get);
  const [issuing, setIssuing] = useState(false);
  const [shown, setShown] = useState<{ token: string; record: McpToken } | null>(null);
  const [client, setClient] = useState<McpClient>('desktop');
  const [asking, setAsking] = useState<'on' | 'networks' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = `${window.location.origin}/api/vlab/mcp`;
  async function switchOff() {
    if (!confirm(L('MCP 서버를 끌까요? 모든 AI 클라이언트의 연결이 바로 멈춥니다.', 'Switch the MCP server off? Every AI client stops at once.'))) return;
    setErr(null);
    try { await mcpApi.save({ enabled: false }); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  async function revoke(t: McpToken) {
    if (!confirm(L(`'${t.name}' 토큰을 폐기할까요? 이 토큰을 쓰는 클라이언트는 바로 끊깁니다.`, `Revoke '${t.name}'? Its client stops at once.`))) return;
    try { await mcpApi.revoke(t.id); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => {
        const locked = !d.inside;
        const lockedWhy = L(`지금 주소(${d.client_ip})가 허용 네트워크 밖이라 켜기 · 발급 · 설정 변경을 할 수 없습니다.`,
          `Your address (${d.client_ip}) is outside the allowed networks: switching on, issuing and changing settings are blocked.`);
        return (
          <>
            <p className="muted small page-intro">{L('PC의 Claude Desktop · Claude Code · 로컬 LLM에서 대화로 VM을 만들고 관리합니다.',
              'Create and manage VMs from Claude Desktop, Claude Code or a local LLM on your PC.')}</p>
            <p className="muted small">{L('폐쇄망(인터넷 없음)에서는 로컬 LLM을 쓰세요. 다른 클라이언트는 모델이 클라우드에 있어 동작하지 않습니다.',
              'On a closed network (no Internet) use a local LLM: the other clients need their cloud model.')}</p>
            <HowTo><ul>
              <li>{L('서버는 인터넷에 열지 않습니다. 허용 네트워크에서 온 호출만 받습니다.', 'The server stays off the Internet; only the allowed networks reach it.')}</li>
              <li>{L('토큰은 만든 사람의 권한 그대로 움직이고, 정한 출발지(기본: 발급한 PC의 대역)에서만 쓸 수 있습니다.', 'A token acts with its maker\'s permissions, only from its sources (default: the issuing PC\'s network).')}</li>
              <li>{L('켜기 · 허용 네트워크 변경 · 토큰 발급은 비밀번호(2단계 인증이면 OTP)를 다시 확인합니다.', 'Switching on, changing the networks and issuing ask for the password (and the 2FA code) again.')}</li>
              <li>{L(`관리 토큰은 플랫폼 관리자만, 최대 ${d.lifetime.manage.max}일. 읽기 토큰은 최대 ${d.lifetime.read.max}일. ${d.idle_days}일 안 쓰면 자동 폐기됩니다.`,
                `Manage tokens: platform admins only, up to ${d.lifetime.manage.max} days. Read: up to ${d.lifetime.read.max}. Unused for ${d.idle_days} days: revoked.`)}</li>
              <li>{L('발급 · 폐기, 처음 보는 주소, 관리 도구 호출, 허용 밖 접근은 경보로 알립니다.', 'Issuing, revoking, a new address, manage tool calls and refused access raise alerts.')}</li>
              <li>{L('삭제 · 되돌리기 · 강제 종료는 AI가 확인(confirm)을 보내야 실행됩니다. 모든 호출은 감사 로그에 남습니다.', 'Delete, roll back and power off need confirm; every call is audited.')}</li>
            </ul></HowTo>

            {locked && <div className="alert small error" role="alert">{lockedWhy}</div>}
            <section className="panel">
              <div className="toolbar">
                <span className={`chip ${d.enabled ? 'chip-ok' : 'chip-gap'}`}>{d.enabled ? L('켜짐', 'On') : L('꺼짐', 'Off')}</span>
                <code className="code">{url}</code>
                {d.all_tokens && (d.enabled
                  ? <button type="button" className="btn" onClick={switchOff}>{L('끄기', 'Switch off')}</button>
                  : <button type="button" className="btn primary" disabled={locked} onClick={() => setAsking('on')}>{L('켜기', 'Switch on')}</button>)}
              </div>
              <div className="toolbar">
                <span className="muted small">{L('허용 네트워크', 'Allowed networks')}</span>
                {d.networks.map((n) => <code key={n} className="code">{n}</code>)}
                {d.all_tokens && <button type="button" className="btn-ghost small-btn" disabled={locked} onClick={() => setAsking('networks')}>{L('변경', 'Change')}</button>}
              </div>
              <p className="muted small">{L(`지금 주소 ${d.client_ip}`, `Your address ${d.client_ip}`)}{' '}
                <span className={`chip ${d.inside ? 'chip-ok' : 'chip-gap'}`}>{d.inside ? L('허용', 'allowed') : L('허용 밖', 'outside')}</span>
                {d.enabled && d.by && <> · {L(`${d.by} · ${when(d.at)}에 변경`, `changed by ${d.by}, ${when(d.at)}`)}</>}</p>
              {!d.enabled && !d.all_tokens && <p className="muted small">{L('플랫폼 관리자가 켜야 쓸 수 있습니다.', 'A platform administrator has to switch it on.')}</p>}
            </section>

            <h3 className="section-title">{L('토큰', 'Tokens')}</h3>
            <div className="toolbar">
              <button type="button" className="btn primary" disabled={locked} title={locked ? lockedWhy : undefined} onClick={() => setIssuing(true)}>
                <Icon name="plus" size={16} />{L('토큰 발급', 'New token')}</button>
              <button type="button" className="btn" onClick={data.reload}><Icon name="refresh" size={16} /></button>
            </div>
            {err && <div className="alert small error" role="alert">{err}</div>}
            {d.tokens.length === 0 ? <div className="empty"><p>{L('발급한 토큰이 없습니다.', 'No tokens yet.')}</p></div> : (
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr><th>{L('이름', 'Name')}</th>{d.all_tokens && <th>{L('주인', 'Owner')}</th>}<th>{L('범위', 'Scope')}</th><th>{L('출발지', 'Sources')}</th>
                  <th>{L('만료', 'Expires')}</th><th>{L('최근 사용', 'Last used')}</th><th className="actions" /></tr></thead>
                <tbody>{d.tokens.map((t) => (
                  <tr key={t.id} className={t.active ? '' : 'row-off'}>
                    <td><span className="strong">{t.name}</span><br /><code className="code">mcp_…{t.token_hint}</code></td>
                    {d.all_tokens && <td>{t.owner}</td>}
                    <td><span className={`chip ${t.scope === 'manage' ? 'chip-accent' : ''}`}>{t.scope === 'manage' ? L('관리', 'Manage') : L('읽기 전용', 'Read only')}</span></td>
                    <td className="muted small">{t.sources.join(', ') || '-'}</td>
                    <td className="muted small">{t.revoked_at
                      ? (t.revoked_by === 'idle' ? L(`미사용 폐기 ${when(t.revoked_at)}`, `revoked (unused) ${when(t.revoked_at)}`) : L(`폐기됨 ${when(t.revoked_at)}`, `revoked ${when(t.revoked_at)}`))
                      : when(t.expires_at)}</td>
                    <td className="muted small">{when(t.last_used_at)}{t.last_ip && <><br />{t.last_ip} · {L(`${t.uses}회`, `${t.uses} calls`)}</>}</td>
                    <td className="actions nowrap">{t.active && <button type="button" className="btn-ghost small-btn danger" onClick={() => revoke(t)}>{L('폐기', 'Revoke')}</button>}</td>
                  </tr>))}</tbody>
              </table></div>
            )}

            <h3 className="section-title">{L('클라이언트 설정', 'Client setup')}</h3>
            <ClientExamples client={client} setClient={setClient} url={url} />

            <h3 className="section-title">{L('도구', 'Tools')}</h3>
            <HowTo label={L(`도구 ${d.tools.length}개 보기`, `Show the ${d.tools.length} tools`)}>
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr><th>{L('도구', 'Tool')}</th><th>{L('설명', 'What')}</th><th>{L('필요한 토큰', 'Token')}</th></tr></thead>
                <tbody>{d.tools.map((x) => (
                  <tr key={x.name}><td><code className="code">{x.name}</code></td><td>{x.title}{x.destructive && <span className="chip chip-gap">{L('확인 필요', 'confirm')}</span>}</td>
                    <td className="muted small">{x.scope === 'manage' ? L('관리', 'Manage') : L('읽기 전용 이상', 'Read or manage')}</td></tr>))}</tbody>
              </table></div>
            </HowTo>

            {asking === 'on' && <ReauthDialog title={L('MCP 켜기', 'Switch MCP on')} needs={d.reauth} onClose={() => setAsking(null)}
              run={(a) => mcpApi.save({ enabled: true, ...a })} onDone={() => { setAsking(null); data.reload(); }} />}
            {asking === 'networks' && <NetworksDialog d={d} onClose={() => setAsking(null)} onDone={() => { setAsking(null); data.reload(); }} />}
            {issuing && <IssueDialog d={d} onClose={() => setIssuing(false)}
              onDone={(r) => { setIssuing(false); data.reload(); setShown(r); }} />}
            {shown && <TokenDialog shown={shown} url={url} onClose={() => setShown(null)} />}
          </>
        );
      }}
    </LoadState>
  );
}

/** The password (and the 2FA code) asked again; an account without a password signs in again instead. */
function ReauthFields({ needs, a, set }: { needs: McpReauthNeed[]; a: McpReauth; set: (a: McpReauth) => void }) {
  const { L } = useL();
  if (needs.includes('recent')) {
    return <p className="muted small">{L('비밀번호가 없는 계정(SSO)은 10분 안에 다시 로그인한 뒤 진행하세요.', 'An account without a password (SSO): sign in again, then do this within 10 minutes.')}</p>;
  }
  return (
    <div className="form-row form-row-even">
      <label><span>{L('비밀번호 확인', 'Your password')}</span>
        <input type="password" required autoComplete="current-password" value={a.user_password ?? ''} onChange={(e) => set({ ...a, user_password: e.target.value })} /></label>
      {needs.includes('otp') && <label><span>{L('OTP 코드', '2FA code')}</span>
        <input required inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={a.otp ?? ''} onChange={(e) => set({ ...a, otp: e.target.value.trim() })} /></label>}
    </div>
  );
}

function ReauthDialog({ title, needs, run, onClose, onDone }: { title: string; needs: McpReauthNeed[]; run: (a: McpReauth) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [a, setA] = useState<McpReauth>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try { await run(a); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={title} onClose={onClose} onSubmit={submit} submitLabel={L('확인', 'Confirm')} busy={busy} error={err}>
      <ReauthFields needs={needs} a={a} set={setA} />
    </Dialog>
  );
}

function NetworksDialog({ d, onClose, onDone }: { d: McpState; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [text, setText] = useState(d.networks.join('\n'));
  const [a, setA] = useState<McpReauth>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const networks = text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  async function submit() {
    if (networks.length === 0) { setErr(L('한 개 이상 넣어야 합니다. 막으려면 MCP를 끄세요.', 'At least one; to block everything switch MCP off.')); return; }
    setBusy(true); setErr(null);
    try { await mcpApi.save({ networks, ...a }); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('허용 네트워크', 'Allowed networks')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={err}>
      <label><span>{L('주소 또는 대역(CIDR), 한 줄에 하나', 'Addresses or networks (CIDR), one per line')}</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="muted small">{L(`지금 주소 ${d.client_ip}가 들어 있어야 저장됩니다.`, `Your address ${d.client_ip} must stay inside.`)}</p>
      <ReauthFields needs={d.reauth} a={a} set={setA} />
    </Dialog>
  );
}

function ClientExamples({ client, setClient, url, token }: { client: McpClient; setClient: (c: McpClient) => void; url: string; token?: string }) {
  const { L } = useL();
  const [copied, setCopied] = useState<McpClient | null>(null);
  const text = mcpSnippet(client, url, token);
  const at = MCP_MODEL_AT[client];
  const note: Record<McpClient, string> = {
    desktop: L('구성 파일에 넣고 다시 엽니다. Node.js가 없으면 확장(.mcpb)을 씁니다.', 'Put it in the config file and reopen; without Node.js use the extension (.mcpb).'),
    claude: L('터미널에서 한 번 실행하면 됩니다.', 'Run it once in a terminal.'),
    gemini: L('settings.json에 넣거나 gemini mcp add로 추가합니다.', 'Put it in settings.json or use gemini mcp add.'),
    codex: L('토큰은 config.toml 대신 환경 변수로 줍니다.', 'The token goes in an environment variable, not config.toml.'),
    local: L('LM Studio · Cherry Studio · Open WebUI(Ollama) · Jan에 붙입니다.', 'LM Studio, Cherry Studio, Open WebUI (Ollama) or Jan.'),
    stdio: L('URL을 받지 못하고 Node.js도 없는 PC용 브리지(Python 3)입니다.', 'A bridge (Python 3) for clients that take no URL on a PC without Node.js.'),
  };
  return (
    <>
      <div className="segmented" role="tablist">
        {MCP_CLIENTS.map((c) => (
          <button key={c} type="button" role="tab" className={client === c ? 'on' : ''} aria-selected={client === c} onClick={() => setClient(c)}>
            {c === 'local' ? L('로컬 LLM', 'Local LLM') : CLIENT_NAME[c]}</button>))}
      </div>
      <p className="muted small">
        <span className={`chip ${at === 'local' ? 'chip-ok' : at === 'cloud' ? 'chip-gap' : ''}`}>
          {at === 'local' ? L('완전 내부', 'Fully internal') : at === 'cloud' ? L('모델이 클라우드', 'Cloud model') : L('모델에 따라', 'Depends on the model')}</span>{' '}
        {at === 'local' ? L('모델도 내부에서 돕니다.', 'The model runs inside too.')
          : at === 'cloud' ? L('인터넷이 필요하고 조회 결과가 모델 회사로 전송됩니다.', 'Needs the Internet; what the tools return goes to the model vendor.')
            : L('로컬 LLM이면 완전 내부, 클라우드 모델이면 외부로 전송됩니다.', 'Internal with a local LLM, sent out with a cloud model.')}
      </p>
      <p className="muted small">{note[client]}</p>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(client)); }}>
          <Icon name="code" size={16} />{copied === client ? L('복사했습니다', 'Copied') : L('설정 복사', 'Copy')}</button>
        <a className="btn" href={MCP_CERT_URL} download><Icon name="download" size={16} />{L('서버 인증서', 'Server certificate')}</a>
        {client === 'desktop' && <a className="btn" href={MCP_MCPB_URL} download><Icon name="download" size={16} />{L('확장 내려받기 (선택)', 'Extension (optional)')}</a>}
      </div>
      <pre className="job-output snippet">{text}</pre>
    </>
  );
}

function IssueDialog({ d, onClose, onDone }: { d: McpState; onClose: () => void; onDone: (r: { token: string; record: McpToken }) => void }) {
  const { L } = useL();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [days, setDays] = useState(d.lifetime.read.default);
  const [sources, setSources] = useState(d.own_network ?? '');
  const [a, setA] = useState<McpReauth>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const choices = [1, 7, 30, 90, 180, 365].filter((n) => n <= d.lifetime[scope].max);
  function pick(s: McpScope) { setScope(s); setDays(d.lifetime[s].default); }
  async function submit() {
    setBusy(true); setErr(null);
    const list = sources.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    try { onDone(await mcpApi.issue({ name: name.trim(), scope, days, sources: list, ...a })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('MCP 토큰 발급', 'New MCP token')} onClose={onClose} onSubmit={submit} submitLabel={L('발급', 'Issue')} busy={busy} error={err}>
      <label><span>{L('이름', 'Name')}</span><input required maxLength={60} value={name} placeholder={L('예: Claude Desktop (내 PC)', 'e.g. Claude Desktop (my PC)')}
        onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-even">
        <label><span>{L('범위', 'Scope')}</span><select value={scope} onChange={(e) => pick(e.target.value as McpScope)}>
          <option value="read">{L('읽기 전용 (조회만)', 'Read only (lists)')}</option>
          <option value="manage" disabled={!d.can_manage}>{d.can_manage ? L('관리 (만들기 · 전원 · 삭제)', 'Manage (create, power, delete)') : L('관리 — 플랫폼 관리자만', 'Manage - platform admins only')}</option>
        </select></label>
        <label><span>{L('유효 기간', 'Valid for')}</span><select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {choices.map((n) => <option key={n} value={n}>{L(`${n}일`, `${n} days`)}{n === d.lifetime[scope].default ? L(' (기본)', ' (default)') : ''}</option>)}</select></label>
      </div>
      <label><span>{L('쓸 수 있는 출발지 (주소 또는 대역)', 'May be used from (addresses or networks)')}</span>
        <input value={sources} placeholder={d.own_network ?? '192.168.0.0/24'} onChange={(e) => setSources(e.target.value)} />
        <small className="muted">{L('기본은 이 PC의 대역입니다. 다른 곳에서 쓰면 거절하고 경보를 보냅니다.', 'Default: this PC\'s network. Use elsewhere is refused and alerted.')}</small></label>
      <ReauthFields needs={d.reauth} a={a} set={setA} />
    </Dialog>
  );
}

function TokenDialog({ shown, url, onClose }: { shown: { token: string; record: McpToken }; url: string; onClose: () => void }) {
  const { L } = useL();
  const [copied, setCopied] = useState(false);
  const [client, setClient] = useState<McpClient>('desktop');
  return (
    <Dialog open wide title={L('MCP 토큰 — 지금 한 번만 보입니다', 'MCP token - shown once')} onClose={onClose}>
      <p className="muted small">{L(`'${shown.record.name}' 토큰입니다. 창을 닫으면 다시 볼 수 없으니 클라이언트 설정에 바로 넣으세요.`,
        `The token of '${shown.record.name}'. It cannot be shown again: put it in the client now.`)}</p>
      <pre className="job-output token-box">{shown.token}</pre>
      <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(shown.token).then(() => setCopied(true)); }}>
        <Icon name="code" size={14} />{copied ? L('복사했습니다', 'Copied') : L('복사', 'Copy')}</button>
      <ClientExamples client={client} setClient={setClient} url={url} token={shown.token} />
    </Dialog>
  );
}

import { useState } from 'react';
import { MCP_CERT_URL, MCP_CLIENTS, MCP_MCPB_URL, mcpApi, mcpSnippet, type McpClient, type McpScope, type McpState, type McpToken } from '../../api/mcp';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정 › MCP 연동: Claude Desktop (an .mcpb extension), Claude Code, Gemini CLI, OpenAI (Codex, Responses API) or a local LLM client
// manages VMs through the engine's MCP server, with a token per person and per client.

const CLIENT_NAME: Record<McpClient, string> = {
  desktop: 'Claude Desktop', claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'OpenAI Codex', openai: 'OpenAI API', local: '로컬 LLM', stdio: 'stdio',
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = `${window.location.origin}/api/vlab/mcp`;
  async function toggle(d: McpState) {
    if (d.enabled && !confirm(L('MCP 서버를 끌까요? 모든 AI 클라이언트의 연결이 바로 멈춥니다.', 'Switch the MCP server off? Every AI client stops at once.'))) return;
    setBusy(true); setErr(null);
    try { await mcpApi.setEnabled(!d.enabled); data.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(t: McpToken) {
    if (!confirm(L(`'${t.name}' 토큰을 폐기할까요? 이 토큰을 쓰는 클라이언트는 바로 끊깁니다.`, `Revoke '${t.name}'? Its client stops at once.`))) return;
    try { await mcpApi.revoke(t.id); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => (
        <>
          <p className="muted small page-intro">{L('Claude Code · Gemini · OpenAI · 로컬 LLM에서 대화로 VM을 만들고 관리합니다.',
            'Create and manage VMs from Claude Code, Gemini, OpenAI or a local LLM.')}</p>
          <HowTo><ul>
            <li>{L('토큰은 만든 사람의 권한 그대로 움직입니다. 풀 관리자는 자기 풀만 다룹니다.', 'A token acts with its maker\'s own permissions; a pool admin reaches their own pools only.')}</li>
            <li>{L('읽기 전용 토큰은 조회 도구만, 관리 토큰은 만들기 · 전원 · 스냅샷 · 삭제까지 씁니다.', 'A read token gets the list tools; a manage token also creates, powers, snapshots and deletes.')}</li>
            <li>{L('삭제 · 되돌리기 · 강제 종료는 AI가 확인(confirm)을 보내야 실행됩니다. 실행 전 물어보게 하세요.', 'Delete, roll back and power off run only with confirm: let the AI ask you first.')}</li>
            <li>{L('모든 호출은 감사 로그에 "vlab.mcp.call"과 "(MCP: 토큰 이름)"으로 남습니다.', 'Every call is in the audit log as vlab.mcp.call and "(MCP: token name)".')}</li>
            <li>{L('비밀번호(템플릿 관리자 암호 등)는 AI 클라이언트에 넘기지 않습니다.', 'Passwords (such as a template\'s administrator password) are not handed to the AI client.')}</li>
            <li>{L('클라우드 모델(Claude · Gemini · OpenAI)을 쓰면 VM 이름 · 사용자 이름 같은 조회 결과가 그 회사로 전송됩니다. 외부 전송이 안 되는 곳은 로컬 LLM을 쓰세요.',
              'With a cloud model, what the tools return (VM and user names) goes to that provider; use a local LLM where that is not allowed.')}</li>
            <li>{L('Claude 웹·앱의 원격 커넥터(설정 › 커넥터)는 Anthropic 클라우드에서 접속하므로 사내 주소에는 닿지 않고 OAuth도 필요해 지금은 쓸 수 없습니다. Claude Desktop은 아래 확장을 쓰세요.',
              'Claude remote connectors (Settings › Connectors) come from Anthropic\'s cloud, cannot reach an internal address and need OAuth: use the Claude Desktop extension below.')}</li>
          </ul></HowTo>

          <section className="panel">
            <div className="toolbar">
              <span className={`chip ${d.enabled ? 'chip-ok' : 'chip-gap'}`}>{d.enabled ? L('켜짐', 'On') : L('꺼짐', 'Off')}</span>
              <code className="code">{url}</code>
              <span className="muted small">Streamable HTTP · {d.protocol}</span>
              {d.all_tokens && <button type="button" className={`btn ${d.enabled ? '' : 'primary'}`} disabled={busy} onClick={() => toggle(d)}>
                {d.enabled ? L('끄기', 'Switch off') : L('켜기', 'Switch on')}</button>}
            </div>
            {d.enabled && d.by && <p className="muted small">{L(`${d.by} · ${when(d.at)}에 켬`, `On by ${d.by}, ${when(d.at)}`)}</p>}
            {!d.enabled && !d.all_tokens && <p className="muted small">{L('플랫폼 관리자가 켜야 쓸 수 있습니다.', 'A platform administrator has to switch it on.')}</p>}
          </section>

          <h3 className="section-title">{L('토큰', 'Tokens')}</h3>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setIssuing(true)}><Icon name="plus" size={16} />{L('토큰 발급', 'New token')}</button>
            <button type="button" className="btn" onClick={data.reload}><Icon name="refresh" size={16} /></button>
          </div>
          {err && <div className="alert small error" role="alert">{err}</div>}
          {d.tokens.length === 0 ? <div className="empty"><p>{L('발급한 토큰이 없습니다.', 'No tokens yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th>{d.all_tokens && <th>{L('주인', 'Owner')}</th>}<th>{L('범위', 'Scope')}</th><th>{L('토큰', 'Token')}</th>
                <th>{L('만료', 'Expires')}</th><th>{L('최근 사용', 'Last used')}</th><th className="actions" /></tr></thead>
              <tbody>{d.tokens.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'row-off'}>
                  <td className="strong">{t.name}</td>
                  {d.all_tokens && <td>{t.owner}</td>}
                  <td><span className={`chip ${t.scope === 'manage' ? 'chip-accent' : ''}`}>{t.scope === 'manage' ? L('관리', 'Manage') : L('읽기 전용', 'Read only')}</span></td>
                  <td className="nowrap"><code className="code">mcp_…{t.token_hint}</code></td>
                  <td className="muted small">{t.revoked_at ? L(`폐기됨 ${when(t.revoked_at)}`, `revoked ${when(t.revoked_at)}`) : when(t.expires_at)}</td>
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

          {issuing && <IssueDialog canManage={d.can_manage} onClose={() => setIssuing(false)}
            onDone={(r) => { setIssuing(false); data.reload(); setShown(r); }} />}
          {shown && <TokenDialog shown={shown} url={url} onClose={() => setShown(null)} />}
        </>
      )}
    </LoadState>
  );
}

function ClientExamples({ client, setClient, url, token }: { client: McpClient; setClient: (c: McpClient) => void; url: string; token?: string }) {
  const { L } = useL();
  const [copied, setCopied] = useState<McpClient | null>(null);
  const text = mcpSnippet(client, url, token);
  const note: Record<McpClient, string> = {
    desktop: L('확장(.mcpb)을 설치하고 토큰을 넣으면 됩니다.', 'Install the extension (.mcpb) and enter the token.'),
    claude: L('터미널에서 한 번 실행하면 됩니다.', 'Run it once in a terminal.'),
    gemini: L('settings.json에 넣거나 gemini mcp add로 추가합니다.', 'Put it in settings.json or use gemini mcp add.'),
    codex: L('토큰은 config.toml 대신 환경 변수로 줍니다.', 'The token goes in an environment variable, not config.toml.'),
    openai: L('OpenAI 서버가 직접 접속하므로 MOAVI Desk가 인터넷에 HTTPS로 열려 있어야 합니다. ChatGPT 앱 커넥터는 OAuth만 받아 지금은 쓸 수 없습니다.',
      'OpenAI\'s servers connect themselves: MOAVI Desk must be reachable over HTTPS from the Internet. ChatGPT app connectors need OAuth and do not work yet.'),
    local: L('LM Studio · Cherry Studio · Open WebUI(Ollama) 같은 데스크톱 앱에 붙입니다.', 'Desktop apps such as LM Studio, Cherry Studio or Open WebUI (Ollama).'),
    stdio: L('URL을 받지 못하고 Node.js도 없는 PC용 브리지(Python 3)입니다.', 'A bridge (Python 3) for clients that take no URL on a PC without Node.js.'),
  };
  return (
    <>
      <div className="segmented" role="tablist">
        {MCP_CLIENTS.map((c) => (
          <button key={c} type="button" role="tab" className={client === c ? 'on' : ''} aria-selected={client === c} onClick={() => setClient(c)}>
            {c === 'local' ? L('로컬 LLM', 'Local LLM') : CLIENT_NAME[c]}</button>))}
      </div>
      <p className="muted small">{note[client]}</p>
      <div className="toolbar">
        {client === 'desktop' && <a className="btn primary" href={MCP_MCPB_URL} download><Icon name="download" size={16} />{L('확장 내려받기', 'Download the extension')}</a>}
        <a className="btn" href={MCP_CERT_URL} download><Icon name="download" size={16} />{L('서버 인증서', 'Server certificate')}</a>
        <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(client)); }}>
          <Icon name="code" size={16} />{copied === client ? L('복사했습니다', 'Copied') : L('설정 복사', 'Copy')}</button>
      </div>
      <pre className="job-output snippet">{text}</pre>
    </>
  );
}

function IssueDialog({ canManage, onClose, onDone }: { canManage: boolean; onClose: () => void; onDone: (r: { token: string; record: McpToken }) => void }) {
  const { L } = useL();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try { onDone(await mcpApi.issue({ name: name.trim(), scope, days })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('MCP 토큰 발급', 'New MCP token')} onClose={onClose} onSubmit={submit} submitLabel={L('발급', 'Issue')} busy={busy} error={err}>
      <label><span>{L('이름', 'Name')}</span><input required maxLength={60} value={name} placeholder={L('예: Claude Code (노트북)', 'e.g. Claude Code (laptop)')}
        onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-even">
        <label><span>{L('범위', 'Scope')}</span><select value={scope} onChange={(e) => setScope(e.target.value as McpScope)}>
          <option value="read">{L('읽기 전용 (조회만)', 'Read only (lists)')}</option>
          <option value="manage" disabled={!canManage}>{L('관리 (만들기 · 전원 · 삭제)', 'Manage (create, power, delete)')}</option>
        </select></label>
        <label><span>{L('유효 기간', 'Valid for')}</span><select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 180, 365].map((n) => <option key={n} value={n}>{L(`${n}일`, `${n} days`)}</option>)}</select></label>
      </div>
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

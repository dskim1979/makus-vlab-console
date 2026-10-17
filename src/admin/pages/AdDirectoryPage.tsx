import { useCallback, useEffect, useState } from 'react';
import { adApi, adErrorText } from '../../api/adobjects';
import type { AdKind, AdListKind, AdNode, AdObject, AdSource, NewGroup } from '../../api/adobjects';
import { ApiError } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useL } from './OpsPages';
import { PasswordInput } from './UsersPage';

// 사용자 > AD 디렉터리: the OU tree and the objects of the bundled DC or of the site's own AD.
// Every change goes to the real directory with that source's bind account (the engine audits it);
// on the bundled DC what the portal keeps (its accounts, moavi-users, department groups) is read-only
// here. Departments stay where they are whatever is done here.

type Lf = (ko: string, en: string) => string;
const kindText = (k: AdKind, L: Lf) => ({ user: L('사용자', 'User'), group: L('그룹', 'Group'), computer: L('컴퓨터', 'Computer'),
  ou: 'OU', container: L('컨테이너', 'Container') }[k]);
const scopeText = (s: string | undefined, L: Lf) => (s === 'universal' ? L('유니버설', 'Universal') : s === 'domain_local' ? L('도메인 로컬', 'Domain local') : L('전역', 'Global'));
const errText = (e: unknown, L: Lf) => {
  const err = e as ApiError;
  const code = err?.body && typeof err.body === 'object' ? (err.body as { code?: string }).code : undefined;
  return adErrorText(code, err?.message ?? String(e), L);
};
const rdn = (dn: string) => dn.split(/(?<!\\),/)[0]?.replace(/^[A-Za-z]+=/, '') ?? dn;

export function AdDirectoryPage() {
  const { L } = useL();
  const [sources, setSources] = useState<AdSource[] | null>(null);
  const [source, setSource] = useState('');
  const [at, setAt] = useState('');
  const [kind, setKind] = useState<AdListKind>('all');
  const [q, setQ] = useState('');
  const [subtree, setSubtree] = useState(false);
  const [rows, setRows] = useState<AdObject[] | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState<'user' | 'group' | 'ou' | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  useEffect(() => {
    adApi.sources().then((s) => { setSources(s); if (s[0]) { setSource(s[0].id); setAt(s[0].base_dn); } })
      .catch((e) => setNotice({ kind: 'error', text: errText(e, L) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const base = sources?.find((s) => s.id === source)?.base_dn ?? '';

  const load = useCallback(() => {
    if (!source || !at) return;
    adApi.objects(source, at, kind, q, subtree).then((r) => setRows(r.objects)).catch((e) => { setRows([]); setNotice({ kind: 'error', text: errText(e, L) }); });
  }, [source, at, kind, q, subtree]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function test() {
    setNotice(null);
    try {
      const t = await adApi.test(source);
      const can = t.can_create;
      setNotice({ kind: 'info', text: L(`연결됨 · 기준 ${t.base_dn}`, `Connected · base ${t.base_dn}`) + (can
        ? L(` · 만들 수 있음: ${[can.user && '사용자', can.group && '그룹', can.organizationalUnit && 'OU'].filter(Boolean).join(', ') || '없음 (읽기 전용 계정)'}`,
          ` · may create: ${[can.user && 'users', can.group && 'groups', can.organizationalUnit && 'OUs'].filter(Boolean).join(', ') || 'nothing (read-only account)'}`)
        : L(' · 만들기 권한은 바꿀 때 디렉터리가 판단합니다', ' · rights are checked by the directory on each change')) });
    } catch (e) { setNotice({ kind: 'error', text: errText(e, L) }); }
  }
  const changed = (text: string) => { setNotice({ kind: 'info', text }); load(); setTreeKey((k) => k + 1); };

  if (sources && sources.length === 0) {
    return <div className="empty"><p>{L('연결된 디렉터리가 없습니다. 내장 디렉터리를 켜거나(설치 .env 의 VLAB_DIRECTORY=1) 운영 > 플랫폼 설정 > 도메인(AD/LDAP) 에서 기관 AD 를 설정하세요.',
      'No directory yet. Turn on the bundled directory (VLAB_DIRECTORY=1) or set up your AD under Operations > Platform settings > Domain.')}</p></div>;
  }
  return (
    <div className="ad-page">
      <div className="toolbar">
        {sources && sources.length > 1 && (
          <select value={source} aria-label={L('디렉터리', 'Directory')} onChange={(e) => { const s = sources.find((x) => x.id === e.target.value)!; setSource(s.id); setAt(s.base_dn); }}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>)}
        {sources?.length === 1 && <span className="chip chip-accent">{sources[0].name}</span>}
        <button type="button" className="btn" onClick={test} disabled={!source}>{L('연결 확인', 'Test connection')}</button>
        <span className="spacer" />
        <button type="button" className="btn" disabled={!at} onClick={() => setMaking('ou')}>{L('새 OU', 'New OU')}</button>
        <button type="button" className="btn" disabled={!at} onClick={() => setMaking('group')}>{L('새 그룹', 'New group')}</button>
        <button type="button" className="btn primary" disabled={!at} onClick={() => setMaking('user')}>{L('새 사용자', 'New user')}</button>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <p className="muted small">{L('바꾸는 것은 곧바로 실제 디렉터리에 쓰이고 작업 기록에 남습니다. 내장 디렉터리의 포털 계정 · moavi-users · 부서 그룹은 사용자 · 부서 화면에서 바꿉니다. 여기서 무엇을 바꿔도 포털의 부서는 움직이지 않습니다.',
        'Changes go straight to the directory and to the audit log. Portal accounts, moavi-users and department groups of the bundled directory are changed under Users / Departments. Nothing here moves a portal department.')}</p>
      <div className="ad-split">
        <aside className="panel ad-tree" aria-label={L('디렉터리 트리', 'Directory tree')}>
          {source && base && <TreeNode key={`${source}-${treeKey}`} source={source} node={{ dn: base, name: base, kind: 'container', description: '', managed: false }}
            at={at} onPick={setAt} depth={0} />}
        </aside>
        <section className="panel ad-list">
          <div className="toolbar">
            <div className="seg" role="tablist">
              {(['all', 'users', 'groups', 'computers', 'ous'] as AdListKind[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {{ all: L('전체', 'All'), users: L('사용자', 'Users'), groups: L('그룹', 'Groups'), computers: L('컴퓨터', 'Computers'), ous: 'OU' }[k]}</button>))}
            </div>
            <input type="search" placeholder={L('이름 · 아이디 · 메일 검색', 'Search name, id, mail')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('검색', 'Search')} />
            <label className="check small"><input type="checkbox" checked={subtree} onChange={(e) => setSubtree(e.target.checked)} />{L('하위 포함', 'Include sub-OUs')}</label>
          </div>
          <p className="muted small"><code className="code">{at}</code></p>
          {rows === null ? <p className="muted">{L('불러오는 중…', 'Loading…')}</p> : rows.length === 0 ? <div className="empty"><p>{L('여기에는 없습니다.', 'Nothing here.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('종류', 'Kind')}</th><th>{L('상태 · 범위', 'State · scope')}</th><th>{L('설명', 'Description')}</th></tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o.dn} className="clickable" onClick={() => (o.kind === 'ou' || o.kind === 'container' ? setAt(o.dn) : setOpen(o.dn))}>
                  <td><span className="ad-name">{o.name}</span>{o.sam && o.sam !== o.name && <span className="muted small"> ({o.sam})</span>}
                    {o.managed && <span className="chip small-chip" title={L('포털이 관리', 'Kept by the portal')}>{L('포털', 'Portal')}</span>}</td>
                  <td>{kindText(o.kind, L)}</td>
                  <td>{o.kind === 'user' || o.kind === 'computer' ? <span className={o.enabled ? 'chip chip-ok' : 'chip chip-warn'}>{o.enabled ? L('사용', 'Enabled') : L('사용 중지', 'Disabled')}</span>
                    : o.kind === 'group' ? `${o.type === 'security' ? L('보안', 'Security') : L('메일', 'Distribution')} · ${scopeText(o.scope, L)}` : '-'}</td>
                  <td className="muted small">{o.description || '-'}</td>
                </tr>))}</tbody>
            </table></div>)}
        </section>
      </div>
      {open && <ObjectDialog source={source} dn={open} onClose={() => setOpen(null)} onChanged={(t) => changed(t)} onDeleted={(t) => { setOpen(null); changed(t); }} />}
      {making && <MakeDialog source={source} parent={at} what={making} onClose={() => setMaking(null)} onMade={(t) => { setMaking(null); changed(t); }} />}
    </div>
  );
}

function TreeNode({ source, node, at, onPick, depth }: { source: string; node: AdNode; at: string; onPick: (dn: string) => void; depth: number }) {
  const { L } = useL();
  const [kids, setKids] = useState<AdNode[] | null>(null);
  const [expanded, setExpanded] = useState(depth === 0);
  useEffect(() => {
    if (expanded && kids === null) adApi.tree(source, node.dn).then((r) => setKids(r.children)).catch(() => setKids([]));
  }, [expanded, kids, source, node.dn]);
  return (
    <div className="ad-node" style={{ paddingLeft: depth ? 12 : 0 }}>
      <div className={`ad-node-row${at.toLowerCase() === node.dn.toLowerCase() ? ' on' : ''}`}>
        <button type="button" className="btn-ghost small-btn" aria-label={expanded ? L('접기', 'Collapse') : L('펼치기', 'Expand')}
          onClick={() => setExpanded((v) => !v)}>{expanded ? '▾' : '▸'}</button>
        <button type="button" className="ad-node-name" onClick={() => onPick(node.dn)}>
          <Icon name={node.kind === 'ou' ? 'layers' : 'pool'} size={14} /> {depth === 0 ? node.dn : node.name}</button>
      </div>
      {expanded && kids?.map((k) => <TreeNode key={k.dn} source={source} node={k} at={at} onPick={onPick} depth={depth + 1} />)}
    </div>
  );
}

function ObjectDialog({ source, dn, onClose, onChanged, onDeleted }: { source: string; dn: string; onClose: () => void;
  onChanged: (t: string) => void; onDeleted: (t: string) => void }) {
  const { L } = useL();
  const [o, setO] = useState<AdObject | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [pw, setPw] = useState('');
  const [add, setAdd] = useState('');
  const [found, setFound] = useState<AdObject[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => adApi.get(source, dn).then((v) => {
    setO(v);
    setF({ displayName: v.display_name ?? '', givenName: v.given_name ?? '', sn: v.surname ?? '', mail: v.mail ?? '', description: v.description ?? '',
      title: v.title ?? '', department: v.department ?? '' });
  }).catch((e) => setError(errText(e, L))), [source, dn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!add.trim() || !o) { setFound([]); return; }
    const t = setTimeout(() => {
      const base = dn.split(/(?<!\\),/).filter((p) => /^DC=/i.test(p.trim())).join(',');
      adApi.objects(source, base, 'all', add.trim(), true).then((r) => setFound(r.objects.filter((x) => x.kind === 'user' || x.kind === 'group' || x.kind === 'computer').slice(0, 8)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [add, source, dn, o]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setError(null);
    try { await fn(); await reload(); onChanged(done); } catch (e) { setError(errText(e, L)); } finally { setBusy(false); }
  }
  const editable = o?.kind === 'user' ? ['displayName', 'givenName', 'sn', 'mail', 'title', 'department', 'description']
    : o?.kind === 'group' ? ['description', 'mail'] : o?.kind === 'ou' ? ['description'] : [];
  const label: Record<string, string> = { displayName: L('표시 이름', 'Display name'), givenName: L('이름', 'Given name'), sn: L('성', 'Surname'),
    mail: L('메일', 'Mail'), title: L('직함', 'Title'), department: L('부서(속성)', 'Department (attribute)'), description: L('설명', 'Description') };
  async function save() {
    if (!o) return;
    const changes = Object.fromEntries(editable.map((k) => [k, f[k] ?? '']));
    await act(() => adApi.update(source, dn, changes), L(`${o.name} 을(를) 바꿨습니다.`, `${o.name} changed.`));
  }
  async function del() {
    if (!o || !confirm(L(`${o.name} 을(를) 디렉터리에서 지울까요? 되돌릴 수 없습니다.`, `Delete ${o.name} from the directory? This cannot be undone.`))) return;
    setBusy(true); setError(null);
    try { await adApi.remove(source, dn); onDeleted(L(`${o.name} 을(를) 지웠습니다.`, `${o.name} deleted.`)); } catch (e) { setError(errText(e, L)); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={o ? `${kindText(o.kind, L)} · ${o.name}` : L('불러오는 중…', 'Loading…')} onClose={onClose}
      onSubmit={editable.length && !o?.managed ? save : undefined} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      {o && (
        <>
          <p className="muted small"><code className="code">{o.dn}</code></p>
          {o.managed && <div className="alert info small">{L('포털이 관리하는 항목이라 여기서는 볼 수만 있습니다. 사용자 · 부서 화면에서 바꾸세요.', 'Kept by the portal: read-only here. Change it under Users / Departments.')}</div>}
          {o.kind === 'group' && <p className="small">{o.type === 'security' ? L('보안 그룹', 'Security group') : L('메일 그룹', 'Distribution group')} · {scopeText(o.scope, L)}{o.sam ? ` · ${o.sam}` : ''}</p>}
          {o.kind === 'user' && <p className="small">{o.sam}{o.upn ? ` · ${o.upn}` : ''} · <span className={o.enabled ? 'chip chip-ok' : 'chip chip-warn'}>{o.enabled ? L('사용', 'Enabled') : L('사용 중지', 'Disabled')}</span></p>}
          {editable.length > 0 && (
            <div className="form-row form-row-even">
              {editable.map((k) => <label key={k}><span>{label[k]}</span>
                <input value={f[k] ?? ''} disabled={o.managed} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
            </div>)}
          {(o.kind === 'user' || o.kind === 'computer') && !o.managed && (
            <div className="toolbar">
              <button type="button" className="btn" disabled={busy} onClick={() => act(() => adApi.setEnabled(source, dn, !o.enabled),
                o.enabled ? L(`${o.name} 사용 중지`, `${o.name} disabled`) : L(`${o.name} 사용`, `${o.name} enabled`))}>
                {o.enabled ? L('사용 중지', 'Disable') : L('사용', 'Enable')}</button>
              {o.kind === 'user' && <>
                <PasswordInput id="ad-pw" value={pw} onChange={setPw} generate />
                <button type="button" className="btn" disabled={busy || !pw} onClick={() => act(async () => { await adApi.setPassword(source, dn, pw); setPw(''); },
                  L(`${o.name} 의 비밀번호를 정했습니다(저장하지 않음).`, `Password of ${o.name} set (not kept).`))}>{L('비밀번호 정하기', 'Set password')}</button>
              </>}
            </div>)}
          {o.member_of && o.member_of.length > 0 && <p className="small"><span className="muted">{L('소속 그룹', 'Member of')}: </span>{o.member_of.map(rdn).join(', ')}</p>}
          {o.kind === 'group' && (
            <section className="acct-section">
              <h3>{L('구성원', 'Members')} <span className="muted small">{o.members?.length ?? 0}</span></h3>
              <ul className="plain-list">{(o.members ?? []).map((m) => (
                <li key={m}><span>{rdn(m)}</span> <span className="muted small">{m}</span>
                  {!o.managed && <button type="button" className="btn-ghost small-btn" disabled={busy}
                    onClick={() => act(() => adApi.member(source, dn, m, 'remove'), L(`${rdn(m)} 을(를) 뺐습니다.`, `${rdn(m)} removed.`))}>{L('빼기', 'Remove')}</button>}</li>))}
              </ul>
              {(o.nested_members?.length ?? 0) > 0 && <p className="small"><span className="muted">{L('하위 그룹을 통한 구성원', 'Through member groups')}: </span>{o.nested_members!.map(rdn).join(', ')}</p>}
              {!o.managed && <>
                <label><span>{L('구성원 더하기 (이름 · 아이디 검색)', 'Add a member (search name or id)')}</span>
                  <input value={add} onChange={(e) => setAdd(e.target.value)} /></label>
                {found.length > 0 && <ul className="plain-list">{found.map((x) => (
                  <li key={x.dn}><button type="button" className="btn-ghost small-btn" disabled={busy}
                    onClick={() => act(async () => { await adApi.member(source, dn, x.dn, 'add'); setAdd(''); }, L(`${x.name} 을(를) 더했습니다.`, `${x.name} added.`))}>
                    + {x.name}</button> <span className="muted small">{kindText(x.kind, L)} · {x.dn}</span></li>))}</ul>}
              </>}
            </section>)}
          {!o.managed && <div><button type="button" className="btn danger" disabled={busy} onClick={del}>{L('지우기', 'Delete')}</button></div>}
        </>
      )}
    </Dialog>
  );
}

function MakeDialog({ source, parent, what, onClose, onMade }: { source: string; parent: string; what: 'user' | 'group' | 'ou'; onClose: () => void; onMade: (t: string) => void }) {
  const { L } = useL();
  const [f, setF] = useState({ name: '', sam: '', display_name: '', given_name: '', surname: '', mail: '', description: '', password: '' });
  const [g, setG] = useState<Pick<NewGroup, 'scope' | 'type'>>({ scope: 'global', type: 'security' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setError(null);
    try {
      const o = what === 'ou' ? await adApi.createOu(source, parent, f.name.trim(), f.description)
        : what === 'group' ? await adApi.createGroup(source, { parent_dn: parent, name: f.name.trim(), description: f.description, ...g })
          : await adApi.createUser(source, { parent_dn: parent, sam: f.sam.trim(), display_name: f.display_name.trim(), given_name: f.given_name.trim(),
            surname: f.surname.trim(), mail: f.mail.trim(), description: f.description, password: f.password || undefined, enabled: true });
      onMade(L(`${o.name} 을(를) 만들었습니다.`, `${o.name} made.`) + (what === 'user' && !f.password ? L(' 비밀번호를 정할 때까지 사용 중지입니다.', ' Disabled until a password is set.') : ''));
    } catch (e) { setError(errText(e, L)); } finally { setBusy(false); }
  }
  const title = { user: L('새 사용자', 'New user'), group: L('새 그룹', 'New group'), ou: L('새 OU', 'New OU') }[what];
  return (
    <Dialog open title={title} onClose={onClose} onSubmit={save} submitLabel={L('만들기', 'Make')} busy={busy} error={error}>
      <p className="muted small">{L('위치', 'In')}: <code className="code">{parent}</code></p>
      {what === 'user' ? (
        <>
          <div className="form-row form-row-even">
            <label><span>{L('로그인 아이디 (sAMAccountName, 20자 이내)', 'Sign-in id (sAMAccountName, ≤ 20)')}</span><input value={f.sam} onChange={set('sam')} required /></label>
            <label><span>{L('표시 이름', 'Display name')}</span><input value={f.display_name} onChange={set('display_name')} /></label>
            <label><span>{L('이름', 'Given name')}</span><input value={f.given_name} onChange={set('given_name')} /></label>
            <label><span>{L('성', 'Surname')}</span><input value={f.surname} onChange={set('surname')} /></label>
            <label><span>{L('메일', 'Mail')}</span><input value={f.mail} onChange={set('mail')} /></label>
            <label><span>{L('설명', 'Description')}</span><input value={f.description} onChange={set('description')} /></label>
          </div>
          <label><span>{L('첫 비밀번호 (비우면 사용 중지로 만듦 · 저장하지 않음)', 'First password (empty: made disabled · never kept)')}</span>
            <PasswordInput id="ad-new-pw" value={f.password} onChange={(v) => setF({ ...f, password: v })} generate /></label>
        </>
      ) : (
        <>
          <label><span>{L('이름', 'Name')}</span><input value={f.name} onChange={set('name')} required /></label>
          {what === 'group' && (
            <div className="form-row form-row-even">
              <label><span>{L('종류', 'Type')}</span><select value={g.type} onChange={(e) => setG({ ...g, type: e.target.value as NewGroup['type'] })}>
                <option value="security">{L('보안 그룹', 'Security')}</option><option value="distribution">{L('메일 그룹', 'Distribution')}</option></select></label>
              <label><span>{L('범위', 'Scope')}</span><select value={g.scope} onChange={(e) => setG({ ...g, scope: e.target.value as NewGroup['scope'] })}>
                <option value="global">{L('전역', 'Global')}</option><option value="universal">{L('유니버설', 'Universal')}</option>
                <option value="domain_local">{L('도메인 로컬', 'Domain local')}</option></select></label>
            </div>)}
          <label><span>{L('설명', 'Description')}</span><input value={f.description} onChange={set('description')} /></label>
        </>
      )}
    </Dialog>
  );
}

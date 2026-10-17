// AD 디렉터리: the objects of the bundled DC or of the site's own AD (makus-vlab
// pegaprox/vlab/adobjects.py, /api/vlab/admin/ad/*). Each change is written to the directory with
// that source's bind account and audited; a password set here goes to the directory only.
import { ApiError, isMock, request } from './client';

export type AdSource = { id: 'bundled' | 'ldap'; name: string; base_dn: string; server: string };
export type AdKind = 'user' | 'group' | 'computer' | 'ou' | 'container';
export type AdNode = { dn: string; name: string; kind: AdKind; description: string; managed: boolean };
export type AdObject = AdNode & {
  sam?: string; upn?: string; display_name?: string; given_name?: string; surname?: string; mail?: string; title?: string;
  department?: string; company?: string; telephone?: string; enabled?: boolean;
  type?: 'security' | 'distribution'; scope?: 'global' | 'universal' | 'domain_local';
  member_of?: string[]; members?: string[]; nested_members?: string[];
};
export type AdTest = { ok: boolean; source: string; base_dn: string; can_create: Record<'user' | 'group' | 'organizationalUnit', boolean> | null };
export type AdListKind = 'all' | 'users' | 'groups' | 'computers' | 'ous';
export type NewUser = { parent_dn: string; sam: string; display_name?: string; given_name?: string; surname?: string; mail?: string;
  description?: string; password?: string; enabled?: boolean };
export type NewGroup = { parent_dn: string; name: string; scope: 'global' | 'universal' | 'domain_local'; type: 'security' | 'distribution'; description?: string };

const enc = encodeURIComponent;
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const P = '/api/vlab/admin/ad';

const real = {
  sources: async () => (await call<{ sources: AdSource[] }>('GET', `${P}/sources`)).sources,
  test: async (source: string) => (await call<{ test: AdTest }>('POST', `${P}/test`, { source })).test,
  tree: (source: string, dn?: string) => call<{ dn: string; children: AdNode[] }>('GET', `${P}/tree?source=${enc(source)}${dn ? `&dn=${enc(dn)}` : ''}`),
  objects: (source: string, dn: string, kind: AdListKind, q: string, subtree: boolean) =>
    call<{ dn: string; objects: AdObject[]; truncated: boolean }>('GET',
      `${P}/objects?source=${enc(source)}&dn=${enc(dn)}&kind=${kind}&q=${enc(q)}${subtree ? '&subtree=1' : ''}`),
  get: async (source: string, dn: string) => (await call<{ object: AdObject }>('GET', `${P}/object?source=${enc(source)}&dn=${enc(dn)}`)).object,
  createOu: async (source: string, parent_dn: string, name: string, description = '') =>
    (await call<{ object: AdObject }>('POST', `${P}/ous`, { source, parent_dn, name, description })).object,
  createGroup: async (source: string, g: NewGroup) => (await call<{ object: AdObject }>('POST', `${P}/groups`, { source, ...g })).object,
  createUser: async (source: string, u: NewUser) => (await call<{ object: AdObject }>('POST', `${P}/users`, { source, ...u })).object,
  update: async (source: string, dn: string, changes: Record<string, string>) =>
    (await call<{ object: AdObject }>('PUT', `${P}/object`, { source, dn, changes })).object,
  setEnabled: async (source: string, dn: string, enabled: boolean) =>
    (await call<{ object: AdObject }>('PUT', `${P}/object/enabled`, { source, dn, enabled })).object,
  setPassword: async (source: string, dn: string, password: string) => { await call('PUT', `${P}/object/password`, { source, dn, password }); },
  remove: async (source: string, dn: string) => { await call('DELETE', `${P}/object`, { source, dn }); },
  member: async (source: string, group_dn: string, member_dn: string, action: 'add' | 'remove') =>
    (await call<{ object: AdObject }>('POST', `${P}/members`, { source, group_dn, member_dn, action })).object,
};

// --- mock: a small bundled domain ------------------------------------------------------------

const BASE = 'DC=moavi,DC=lan';
const M = `OU=MOAVI,${BASE}`;
type Rec = AdObject & { parent: string };
const dit = new Map<string, Rec>();
const key = (dn: string) => dn.toLowerCase();
function put(parent: string, o: Omit<Rec, 'parent' | 'dn'> & { rdn: string }) {
  const { rdn, ...rest } = o;
  const dn = `${rdn},${parent}`;
  dit.set(key(dn), { ...rest, dn, parent } as Rec);
  return dn;
}
const ou = (parent: string, name: string, managed = false, description = '') =>
  put(parent, { rdn: `OU=${name}`, name, kind: 'ou', description, managed });
function seed() {
  if (dit.size) return;
  put(BASE, { rdn: 'CN=Users', name: 'Users', kind: 'container', description: 'Default container for upgraded user accounts', managed: false });
  put(BASE, { rdn: 'CN=Computers', name: 'Computers', kind: 'container', description: '', managed: false });
  ou(BASE, 'Domain Controllers');
  ou(BASE, 'MOAVI');
  const users = ou(M, 'Users'); const groups = ou(M, 'Groups'); ou(M, 'Desktops'); const svc = ou(M, 'Service');
  const lab = ou(M, '연구소', false, '연구소 공용 계정 · 그룹');
  const portal = ['kim.minsu', 'lee.jiwon', 'park.sora'].map((u) => put(users, { rdn: `CN=${u}`, name: u, kind: 'user', description: '', managed: true,
    sam: u, upn: `${u}@moavi.lan`, display_name: u, enabled: true, mail: `${u}@univ.ac.kr`, member_of: [] }));
  put(groups, { rdn: 'CN=moavi-users', name: 'moavi-users', kind: 'group', description: 'MOAVI Desk: every portal account', managed: true,
    sam: 'moavi-users', type: 'security', scope: 'global', members: portal });
  put(groups, { rdn: 'CN=dep-dep_1', name: 'dep-dep_1', kind: 'group', description: '전자공학과', managed: true, sam: 'dep-dep_1', type: 'security',
    scope: 'global', members: portal.slice(0, 2) });
  put(svc, { rdn: 'CN=vlab-svc', name: 'vlab-svc', kind: 'user', description: 'MOAVI Desk engine: manages OU=MOAVI', managed: false, sam: 'vlab-svc', enabled: true });
  put(svc, { rdn: 'CN=vlab-join', name: 'vlab-join', kind: 'user', description: 'MOAVI Desk: joins desktops', managed: false, sam: 'vlab-join', enabled: true });
  const kiosk = put(lab, { rdn: 'CN=Kiosk 1', name: 'Kiosk 1', kind: 'user', description: '로비 키오스크', managed: false, sam: 'kiosk1',
    display_name: 'Kiosk 1', enabled: true });
  const g2 = put(lab, { rdn: 'CN=lab-mail', name: 'lab-mail', kind: 'group', description: '메일 배포', managed: false, sam: 'lab-mail',
    type: 'distribution', scope: 'universal', members: [kiosk] });
  put(lab, { rdn: 'CN=lab-all', name: 'lab-all', kind: 'group', description: '연구소 전체', managed: false, sam: 'lab-all', type: 'security',
    scope: 'universal', members: [g2] });
}
const wait = <T,>(v: T, ms = 150) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string, code: string): never => { throw new ApiError(status, msg, { error: msg, code }); };
const one = (dn: string) => dit.get(key(dn)) ?? fail(404, `${dn} is not there`, 'NOT_FOUND');
const view = (r: Rec): AdObject => {
  const v: AdObject = { ...r, member_of: [...dit.values()].filter((g) => g.members?.some((m) => key(m) === key(r.dn))).map((g) => g.dn) };
  delete (v as Partial<Rec>).parent;
  return v;
};
function nested(dn: string, seen = new Map<string, string>()) {
  for (const m of dit.get(key(dn))?.members ?? []) {
    if (seen.has(key(m))) continue;
    seen.set(key(m), m);
    nested(m, seen);
  }
  return seen;
}
const guard = (dn: string) => { if (one(dn).managed) fail(409, `${one(dn).name} follows the portal (users and departments in the console)`, 'MANAGED'); };
const run = <T,>(fn: () => T) => { try { seed(); return wait(fn()); } catch (e) { return Promise.reject(e); } };

const mock: typeof real = {
  sources: () => wait([{ id: 'bundled', name: '내장 디렉터리 (moavi.lan)', base_dn: BASE, server: 'dc1.moavi.lan' }]),
  test: (source) => wait({ ok: true, source, base_dn: BASE, can_create: { user: true, group: true, organizationalUnit: true } }, 400),
  tree: (_s, dn) => run(() => ({ dn: dn ?? BASE, children: [...dit.values()].filter((r) => key(r.parent) === key(dn ?? BASE) && (r.kind === 'ou' || r.kind === 'container'))
    .map((r) => ({ dn: r.dn, name: r.name, kind: r.kind, description: r.description, managed: r.managed }))
    .sort((a, b) => Number(a.kind !== 'ou') - Number(b.kind !== 'ou') || a.name.localeCompare(b.name)) })),
  objects: (_s, dn, kind, q, subtree) => run(() => {
    const want = { all: ['user', 'group', 'ou', 'container'], users: ['user'], groups: ['group'], computers: ['computer'], ous: ['ou'] }[kind];
    const ql = q.trim().toLowerCase();
    const list = [...dit.values()].filter((r) => (subtree || ql ? key(r.dn).endsWith(`,${key(dn)}`) : key(r.parent) === key(dn)) && want.includes(r.kind)
      && (!ql || [r.name, r.sam, r.display_name, r.mail, r.description].some((x) => (x ?? '').toLowerCase().includes(ql))));
    return { dn, objects: list.map(view).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), truncated: false };
  }),
  get: (_s, dn) => run(() => {
    const v = view(one(dn));
    if (v.kind === 'group') {
      const direct = new Set((v.members ?? []).map(key));
      v.nested_members = [...nested(dn).entries()].filter(([k]) => !direct.has(k) && k !== key(dn)).map(([, d]) => d);
    }
    return v;
  }),
  createOu: (_s, parent, name, description = '') => run(() => view(one(ou(parent, name, false, description)))),
  createGroup: (_s, g) => run(() => view(one(put(g.parent_dn, { rdn: `CN=${g.name}`, name: g.name, kind: 'group', description: g.description ?? '',
    managed: false, sam: g.name, type: g.type, scope: g.scope, members: [] })))),
  createUser: (_s, u) => run(() => {
    if (key(u.parent_dn) === key(`OU=Users,${M}`)) fail(409, 'portal accounts are made under 사용자 in the console', 'MANAGED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(u.sam)) fail(400, 'sAMAccountName: 1-20 letters, digits, ".", "_" or "-"', 'BAD_NAME');
    const name = u.display_name || u.sam;
    return view(one(put(u.parent_dn, { rdn: `CN=${name}`, name, kind: 'user', description: u.description ?? '', managed: false, sam: u.sam,
      upn: `${u.sam}@moavi.lan`, display_name: u.display_name, given_name: u.given_name, surname: u.surname, mail: u.mail,
      enabled: !!u.password && u.enabled !== false })));
  }),
  update: (_s, dn, changes) => run(() => {
    guard(dn);
    const r = one(dn);
    const map: Record<string, keyof Rec> = { displayName: 'display_name', givenName: 'given_name', sn: 'surname', mail: 'mail', description: 'description',
      title: 'title', department: 'department', company: 'company', telephoneNumber: 'telephone' };
    for (const [k, v] of Object.entries(changes)) (r as Record<string, unknown>)[map[k] ?? k] = v;
    return view(r);
  }),
  setEnabled: (_s, dn, enabled) => run(() => { guard(dn); const r = one(dn); r.enabled = enabled; return view(r); }),
  setPassword: (_s, dn) => run(() => { guard(dn); one(dn); }),
  remove: (_s, dn) => run(() => {
    guard(dn);
    if ([...dit.values()].some((r) => key(r.parent) === key(dn))) fail(409, `${one(dn).name} is not empty - move or delete what is in it first`, 'NOT_EMPTY');
    dit.delete(key(dn));
    for (const g of dit.values()) if (g.members) g.members = g.members.filter((m) => key(m) !== key(dn));
  }),
  member: (_s, gdn, mdn, action) => run(() => {
    guard(gdn);
    const g = one(gdn); const m = one(mdn);
    if (action === 'add') {
      if (key(gdn) === key(mdn)) fail(409, 'a group cannot be a member of itself', 'SELF');
      if (m.kind === 'group' && nested(mdn).has(key(gdn))) fail(409, `${m.name} already contains ${g.name} - adding it would make a loop`, 'CYCLE');
      if (!g.members?.some((x) => key(x) === key(mdn))) g.members = [...(g.members ?? []), m.dn];
    } else g.members = (g.members ?? []).filter((x) => key(x) !== key(mdn));
    return view(g);
  }),
};

export const adApi = isMock ? mock : real;

export function adErrorText(code: string | undefined, msg: string, L: (ko: string, en: string) => string): string {
  const m: Record<string, [string, string]> = {
    MANAGED: ['포털이 관리하는 항목입니다 — 사용자 · 부서 화면에서 바꾸세요', 'Kept by the portal - change it under Users / Departments'],
    CYCLE: ['그룹이 돌고 도는 구성이 됩니다', 'That would make a loop of groups'], SELF: ['그룹은 자기 자신의 구성원이 될 수 없습니다', 'A group cannot contain itself'],
    NOT_EMPTY: ['비어 있지 않은 OU 는 지울 수 없습니다', 'An OU must be empty to be deleted'],
    DENIED: ['바인드 계정에 이 권한이 없습니다 — 디렉터리에서 권한을 위임하세요', 'The bind account lacks this right - delegate it in the directory'],
    UNREACHABLE: ['디렉터리에 연결할 수 없습니다', 'The directory cannot be reached'], OUTSIDE: ['기준 DN 밖입니다', 'Outside the base DN'],
    EXISTS: ['같은 이름이 이미 있습니다', 'That name is taken'],
  };
  const v = code ? m[code] : undefined;
  return v ? `${L(v[0], v[1])} (${msg})` : msg;
}

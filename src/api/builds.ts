// Build results kept and CI connections (makus-vlab pegaprox/api/vlab_builds.py):
//   /api/vlab/admin/build-artifacts[/<scope>]   what a build farm pool keeps (patterns, size, days)
//   /api/vlab/me|admin/build-jobs/<id>/artifacts/<i>   one result file (a plain link, asked first with ?probe=1)
//   /api/vlab/admin/ci-links[/<id>[/token]]    GitLab CI / Jenkins / generic connections with a token shown once
import { ApiError, isMock, request } from './client';

export type ArtifactSettings = { enabled: boolean; patterns: string[]; max_files: number; max_mb: number; keep_days: number };
export type ArtifactPool = { id: string; name: string; own: boolean; settings: ArtifactSettings; storage: boolean };
export type Artifacts = { default: ArtifactSettings; pools: ArtifactPool[] };
export type CiKind = 'gitlab' | 'jenkins' | 'generic';
export type CiLink = {
  id: string; name: string; kind: CiKind; pool_id: string; pool: string | null; owner: string; command: string; workdir: string;
  allow_command: boolean; enabled: boolean; expires_at: string | null; token_hint: string; created_by: string; created_at: string;
  last_used_at: string | null; uses: number;
};
export type CiLinkInput = Partial<Pick<CiLink, 'name' | 'kind' | 'pool_id' | 'owner' | 'command' | 'workdir' | 'allow_command' | 'enabled' | 'expires_at'>>;
export type CiLinks = { links: CiLink[]; pools: { id: string; name: string }[]; kinds: CiKind[] };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
  return data;
}
const enc = encodeURIComponent;
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

export function artifactUrl(jobId: string, i: number, admin: boolean) {
  return `/api/vlab/${admin ? 'admin' : 'me'}/build-jobs/${enc(jobId)}/artifacts/${i}`;
}

/** Ask first (every check, nothing sent), then start the download with a plain link. */
export async function downloadArtifact(url: string) {
  if (isMock) return;
  const { status, data } = await request<{ code?: string; error?: string }>('GET', `${url}?probe=1`);
  if (status >= 400) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- mock -----------------------------------------------------------------------------------
const DEF: ArtifactSettings = { enabled: true, patterns: ['*.bit', '*.bin', '*.xclbin', '*.xsa', '*.ltx', '*.sof', '*.pof', '*.rpt', '*.log'], max_files: 50, max_mb: 1024, keep_days: 90 };
let mockDefault = { ...DEF };
const mockOwn: Record<string, Partial<ArtifactSettings>> = { 'pool-gpu': { patterns: ['*.pt', '*.onnx', '*.safetensors', 'metrics.json', '*.log'], max_mb: 20000, keep_days: 30 } };
const mockPools = [{ id: 'pool-fpga', name: 'FPGA 빌드 팜', storage: true }, { id: 'pool-gpu', name: 'A100 학습 팜', storage: true }];
let seq = 3;
const mockLinks: CiLink[] = [
  { id: 'ci-1', name: 'FPGA팀 GitLab', kind: 'gitlab', pool_id: 'pool-fpga', pool: 'FPGA 빌드 팜', owner: 'alice',
    command: 'git -C ~/src/zcu102 fetch -q && git -C ~/src/zcu102 checkout -q "$MOAVI_CI_COMMIT" && make -C ~/src/zcu102 bit', workdir: '',
    allow_command: false, enabled: true, expires_at: '2027-03-31T00:00:00+00:00', token_hint: 'Qx7w', created_by: 'admin',
    created_at: '2026-10-10T09:00:00+00:00', last_used_at: '2026-10-17T08:42:00+00:00', uses: 37 },
  { id: 'ci-2', name: 'SoC 검증 Jenkins', kind: 'jenkins', pool_id: 'pool-fpga', pool: 'FPGA 빌드 팜', owner: 'bob',
    command: 'make -C /nas/projects/soc regress', workdir: '/nas/projects/soc', allow_command: true, enabled: true, expires_at: null,
    token_hint: 'k2Pa', created_by: 'admin', created_at: '2026-09-02T09:00:00+00:00', last_used_at: '2026-10-16T22:10:00+00:00', uses: 112 },
];
const mockView = (): Artifacts => ({ default: { ...mockDefault }, pools: mockPools.map((p) => ({ ...p, own: !!mockOwn[p.id], settings: { ...mockDefault, ...(mockOwn[p.id] ?? {}) } })) });
const token = () => `mci_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const mock = {
  artifacts: () => delay(mockView()),
  saveArtifacts: (scope: string, s: Partial<ArtifactSettings> | null) => {
    if (scope === '_default') mockDefault = { ...mockDefault, ...(s ?? {}) };
    else if (s === null) delete mockOwn[scope];
    else mockOwn[scope] = { ...(mockOwn[scope] ?? {}), ...s };
    return delay(mockView());
  },
  ciLinks: () => delay<CiLinks>({ links: mockLinks.map((l) => ({ ...l })), pools: mockPools.map(({ id, name }) => ({ id, name })), kinds: ['gitlab', 'jenkins', 'generic'] }),
  createCiLink: (b: CiLinkInput) => {
    const t = token();
    const l: CiLink = { id: `ci-${seq++}`, name: b.name ?? 'CI', kind: b.kind ?? 'generic', pool_id: b.pool_id ?? 'pool-fpga',
      pool: mockPools.find((p) => p.id === b.pool_id)?.name ?? null, owner: b.owner ?? 'alice', command: b.command ?? 'make', workdir: b.workdir ?? '',
      allow_command: !!b.allow_command, enabled: b.enabled ?? true, expires_at: b.expires_at ?? null, token_hint: t.slice(-4), created_by: 'admin',
      created_at: new Date().toISOString(), last_used_at: null, uses: 0 };
    mockLinks.push(l);
    return delay({ link: { ...l }, token: t });
  },
  updateCiLink: (id: string, b: CiLinkInput) => {
    const l = mockLinks.find((x) => x.id === id);
    if (l) Object.assign(l, b, { pool: mockPools.find((p) => p.id === (b.pool_id ?? l.pool_id))?.name ?? l.pool });
    return delay({ link: { ...(l as CiLink) } });
  },
  deleteCiLink: (id: string) => { const i = mockLinks.findIndex((x) => x.id === id); if (i >= 0) mockLinks.splice(i, 1); return delay({ success: true }); },
  newCiToken: (id: string) => { const t = token(); const l = mockLinks.find((x) => x.id === id); if (l) l.token_hint = t.slice(-4); return delay({ link: { ...(l as CiLink) }, token: t }); },
};

const real = {
  artifacts: () => call<Artifacts>('GET', '/api/vlab/admin/build-artifacts'),
  saveArtifacts: (scope: string, s: Partial<ArtifactSettings> | null) => call<Artifacts>('PUT', `/api/vlab/admin/build-artifacts/${enc(scope)}`, s),
  ciLinks: () => call<CiLinks>('GET', '/api/vlab/admin/ci-links'),
  createCiLink: (b: CiLinkInput) => call<{ link: CiLink; token: string }>('POST', '/api/vlab/admin/ci-links', b),
  updateCiLink: (id: string, b: CiLinkInput) => call<{ link: CiLink }>('PUT', `/api/vlab/admin/ci-links/${enc(id)}`, b),
  deleteCiLink: (id: string) => call<{ success: boolean }>('DELETE', `/api/vlab/admin/ci-links/${enc(id)}`),
  newCiToken: (id: string) => call<{ link: CiLink; token: string }>('POST', `/api/vlab/admin/ci-links/${enc(id)}/token`),
};

export const buildsApi = isMock ? mock : real;

/** The lines a CI puts in its job: GitLab CI (.gitlab-ci.yml), Jenkins (Jenkinsfile) or a plain shell. */
export function ciSnippet(kind: CiKind, server: string, tokenVar = 'MOAVI_CI_TOKEN') {
  const submit = (repo: string, ref: string, commit: string, pipe: string, url: string) =>
    `curl -fsS -X POST "${server}/api/vlab/ci/jobs" -H "Authorization: Bearer $${tokenVar}" -H "X-Requested-With: XMLHttpRequest" -H "Content-Type: application/json" \\\n` +
    `  -d "{\\"repo\\":\\"${repo}\\",\\"ref\\":\\"${ref}\\",\\"commit\\":\\"${commit}\\",\\"pipeline\\":\\"${pipe}\\",\\"url\\":\\"${url}\\"}"`;
  const poll =
    `while :; do S=$(curl -fsS "${server}/api/vlab/ci/jobs/$JOB" -H "Authorization: Bearer $${tokenVar}"); \\\n` +
    `  [ "$(echo "$S" | jq -r .job.done)" = true ] && break; sleep 30; done\n` +
    `echo "$S" | jq -r .job.output_tail\n` +
    `echo "$S" | jq -r '.job.artifacts[].url' | while read u; do curl -fsS -OJ "$u" -H "Authorization: Bearer $${tokenVar}"; done\n` +
    `[ "$(echo "$S" | jq -r .job.status)" = done ]`;
  if (kind === 'gitlab') {
    return `# .gitlab-ci.yml - 설정 › CI/CD › 변수에 MOAVI_CI_TOKEN (Masked)\nmoavi-build:\n  stage: build\n  image: alpine:3.20\n  before_script: [apk add --no-cache curl jq]\n  script:\n    - |\n` +
      [`JOB=$(${submit('$CI_PROJECT_PATH', '$CI_COMMIT_REF_NAME', '$CI_COMMIT_SHA', '$CI_PIPELINE_ID', '$CI_PIPELINE_URL')} | jq -r .job.id)`, poll]
        .join('\n').split('\n').map((l) => `      ${l}`).join('\n') + `\n  artifacts:\n    paths: ["*.bit", "*.rpt", "*.log"]\n    expire_in: 30 days\n`;
  }
  if (kind === 'jenkins') {
    return `// Jenkinsfile - Credentials에 Secret text "moavi-ci-token"\npipeline {\n  agent any\n  stages {\n    stage('MOAVI Desk build') {\n      steps {\n        withCredentials([string(credentialsId: 'moavi-ci-token', variable: '${tokenVar}')]) {\n          sh '''\n` +
      [`JOB=$(${submit('$JOB_NAME', '$GIT_BRANCH', '$GIT_COMMIT', '$BUILD_NUMBER', '$BUILD_URL')} | jq -r .job.id)`, poll]
        .join('\n').split('\n').map((l) => `            ${l}`).join('\n') + `\n          '''\n        }\n      }\n    }\n  }\n  post { always { archiveArtifacts artifacts: '*.bit, *.rpt, *.log', allowEmptyArchive: true } }\n}\n`;
  }
  return `# 어느 CI에서나 (curl · jq) - ${tokenVar} 에 토큰\nJOB=$(${submit('my/repo', 'main', '$(git rev-parse HEAD)', '', '')} | jq -r .job.id)\n${poll}\n`;
}

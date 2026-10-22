// The MCP server for administrators (makus-vlab pegaprox/api/vlab_mcp.py):
//   GET/PUT /api/vlab/admin/mcp             on / off, the tokens, the tools
//   POST    /api/vlab/admin/mcp/tokens       {name, scope, days} -> the token, shown once
//   DELETE  /api/vlab/admin/mcp/tokens/<id>  revoke
// AI clients call POST /api/vlab/mcp with Authorization: Bearer mcp_...
import { ApiError, isMock, request } from './client';

export type McpScope = 'read' | 'manage';
export type McpToken = {
  id: string; name: string; owner: string; scope: McpScope; token_hint: string; created_by: string; created_at: string;
  expires_at: string; revoked_at: string | null; revoked_by: string; last_used_at: string | null; last_ip: string; uses: number; active: boolean;
};
export type McpTool = { name: string; title: string; scope: McpScope; destructive: boolean };
export type McpState = {
  enabled: boolean; by: string; at: string; tokens: McpToken[]; all_tokens: boolean; can_manage: boolean;
  tools: McpTool[]; path: string; protocol: string;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.error || data?.code || `HTTP ${status}`, data);
  return data;
}
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

// --- mock --------------------------------------------------------------------------------------
const T = (name: string, title: string, scope: McpScope, destructive = false): McpTool => ({ name, title, scope, destructive });
const mockTools: McpTool[] = [
  T('list_clusters', '클러스터 목록', 'read'), T('list_nodes', '노드 목록', 'read'), T('list_storage', '스토리지 목록', 'read'),
  T('list_networks', '네트워크 브리지', 'read'), T('list_isos', 'ISO 목록', 'read'), T('list_vms', 'VM 목록', 'read'),
  T('list_templates', '템플릿 목록', 'read'), T('list_golden_images', '골든 이미지 목록', 'read'), T('list_pools', '데스크톱 풀 목록', 'read'),
  T('list_desktops', '데스크톱 목록', 'read'), T('get_desktop', '데스크톱 상세', 'read'), T('list_snapshots', '스냅샷 목록', 'read'),
  T('list_users', '사용자 목록', 'read'), T('list_template_builds', '템플릿 만들기 목록', 'read'), T('get_template_build', '템플릿 빌드 상태', 'read'),
  T('get_task', '작업 상태', 'read'),
  T('create_vm_from_iso', 'ISO로 VM 만들기', 'manage'), T('create_desktops_from_template', '템플릿으로 데스크톱 만들기', 'manage'),
  T('deploy_golden_image', '골든 이미지로 데스크톱 만들기', 'manage'), T('power_desktop', '데스크톱 전원', 'manage'), T('power_vm', 'VM 전원', 'manage'),
  T('take_snapshot', '스냅샷 만들기', 'manage'), T('rollback_snapshot', '스냅샷으로 되돌리기', 'manage', true),
  T('delete_snapshot', '스냅샷 삭제', 'manage', true), T('delete_desktop', '데스크톱 삭제', 'manage', true), T('delete_vm', 'VM 삭제', 'manage', true),
  T('assign_desktop', '데스크톱 배정', 'manage'), T('start_template_build', '템플릿 만들기 시작', 'manage'),
  T('cancel_template_build', '템플릿 만들기 취소', 'manage', true),
];
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 19) + '+00:00';
const mockTokens: McpToken[] = [
  { id: 'mcp_1', name: 'Claude Code (김관리)', owner: 'admin', scope: 'manage', token_hint: 'x7Qa', created_by: 'admin', created_at: days(-12),
    expires_at: days(78), revoked_at: null, revoked_by: '', last_used_at: days(-0.02), last_ip: '10.0.3.21', uses: 412, active: true },
  { id: 'mcp_2', name: 'LM Studio 조회용', owner: 'admin', scope: 'read', token_hint: 'Lm42', created_by: 'admin', created_at: days(-30),
    expires_at: days(60), revoked_at: null, revoked_by: '', last_used_at: days(-2), last_ip: '10.0.3.40', uses: 57, active: true },
];
const mock = { enabled: false, by: '', at: '' };
let seq = 3;
const rnd = () => Math.random().toString(36).slice(2);

export const mcpApi = isMock ? {
  get: () => delay<McpState>({ ...mock, tokens: mockTokens.map((x) => ({ ...x })), all_tokens: true, can_manage: true,
    tools: mockTools, path: '/api/vlab/mcp', protocol: '2025-11-25' }),
  setEnabled: (enabled: boolean) => { Object.assign(mock, { enabled, by: 'admin', at: days(0) }); return delay({ ...mock }); },
  issue: (b: { name: string; scope: McpScope; days: number }) => {
    const token = `mcp_${rnd()}${rnd()}${rnd()}`;
    const record: McpToken = { id: `mcp_${seq++}`, name: b.name, owner: 'admin', scope: b.scope, token_hint: token.slice(-4), created_by: 'admin',
      created_at: days(0), expires_at: days(b.days), revoked_at: null, revoked_by: '', last_used_at: null, last_ip: '', uses: 0, active: true };
    mockTokens.unshift(record);
    return delay({ token, record: { ...record } });
  },
  revoke: (id: string) => {
    const r = mockTokens.find((x) => x.id === id);
    if (r) Object.assign(r, { revoked_at: days(0), revoked_by: 'admin', active: false });
    return delay({ record: { ...(r as McpToken) } });
  },
} : {
  get: () => call<McpState>('GET', '/api/vlab/admin/mcp'),
  setEnabled: (enabled: boolean) => call<{ enabled: boolean; by: string; at: string }>('PUT', '/api/vlab/admin/mcp', { enabled }),
  issue: (b: { name: string; scope: McpScope; days: number }) => call<{ token: string; record: McpToken }>('POST', '/api/vlab/admin/mcp/tokens', b),
  revoke: (id: string) => call<{ record: McpToken }>('DELETE', `/api/vlab/admin/mcp/tokens/${encodeURIComponent(id)}`),
};

// Only clients that run on the admin's PC or an internal server and reach /api/vlab/mcp at its internal
// address: MOAVI Desk is not opened to the Internet, so nothing that connects from a vendor's cloud.
export type McpClient = 'claude' | 'desktop' | 'gemini' | 'codex' | 'local' | 'stdio';
export const MCP_CLIENTS: McpClient[] = ['desktop', 'claude', 'gemini', 'codex', 'local', 'stdio'];
// where the model runs: 'cloud' sends what the tools return to the model's vendor, 'local' keeps it inside
export const MCP_MODEL_AT: Record<McpClient, 'cloud' | 'local' | 'either'> = {
  desktop: 'cloud', claude: 'cloud', gemini: 'cloud', codex: 'cloud', local: 'local', stdio: 'either',
};

// the console's own certificate (nginx /moavi-gateway.crt) and the Claude Desktop extension (engine)
export const MCP_CERT_URL = '/moavi-gateway.crt';
export const MCP_MCPB_URL = '/api/vlab/mcp/moavi-desk.mcpb';

/** How an AI client is told about the server. TOKEN is a placeholder unless the token was just made. */
// 'moavi-desk', not 'moavi': MOAVI (makus-virt) has its own MCP server and an admin may have both.
export function mcpSnippet(client: McpClient, url: string, token = '<mcp_토큰>', name = 'moavi-desk') {
  const origin = url.replace(/\/api\/vlab\/mcp$/, '');
  switch (client) {
    case 'desktop':
      return `# Claude Desktop - 설정 › 개발자 › 구성 편집 (claude_desktop_config.json), PC에 Node.js 필요\n` +
        `#   Windows: %APPDATA%\\Claude\\claude_desktop_config.json\n` +
        `#   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json\n` +
        `{\n  "mcpServers": {\n    "${name}": {\n      "command": "npx",\n` +
        `      "args": ["-y", "mcp-remote", "${url}", "--header", "Authorization:\${MOAVI_DESK_AUTH}"],\n` +
        `      "env": {\n        "MOAVI_DESK_AUTH": "Bearer ${token}",\n` +
        `        "NODE_EXTRA_CA_CERTS": "C:\\\\Users\\\\<사용자>\\\\Downloads\\\\moavi-gateway.crt"\n      }\n    }\n  }\n}\n` +
        `# Windows에서 npx를 못 찾으면 "command": "cmd", "args": ["/c", "npx", "-y", "mcp-remote", ...]\n` +
        `# 저장 후 Claude Desktop을 완전히 끝냈다가 다시 엽니다.\n\n` +
        `# 선택: Node.js 없이 확장으로 - [확장 내려받기]의 moavi-desk.mcpb 를 두 번 클릭하고 토큰과 서버 인증서 파일을 넣습니다.`;
    case 'claude':
      return `# Claude Code (터미널) - 이 프로젝트 폴더에서만 (local)\nclaude mcp add --transport http --scope local ${name} ${url} \\\n  --header "Authorization: Bearer ${token}"\n\n` +
        `# 팀이 함께 쓰려면 --scope project (.mcp.json) 로 하고 토큰은 환경 변수로: --header "Authorization: Bearer \${MOAVI_DESK_MCP_TOKEN}"\n` +
        `# 확인: claude mcp list\n` +
        `# 자체 서명 인증서면 먼저: export NODE_EXTRA_CA_CERTS=/path/moavi-gateway.crt`;
    case 'gemini':
      return `# Gemini CLI - ~/.gemini/settings.json (프로젝트는 .gemini/settings.json)\n{\n  "mcpServers": {\n    "${name}": {\n` +
        `      "httpUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" },\n      "timeout": 120000\n    }\n  }\n}\n\n` +
        `# 또는: gemini mcp add --transport http ${name} ${url} --header "Authorization: Bearer ${token}"\n# 확인: gemini 안에서 /mcp\n` +
        `# 자체 서명 인증서면 먼저: export NODE_EXTRA_CA_CERTS=/path/moavi-gateway.crt`;
    case 'codex':
      return `# OpenAI Codex CLI - ~/.codex/config.toml\n[mcp_servers.${name}]\nurl = "${url}"\nbearer_token_env_var = "MOAVI_DESK_MCP_TOKEN"\n\n` +
        `# 셸에서 토큰을 환경 변수로:\nexport MOAVI_DESK_MCP_TOKEN=${token}\n# 확인: codex mcp list\n` +
        `# 예전 버전은 config.toml 맨 위에 experimental_use_rmcp_client = true 가 필요합니다.\n` +
        `# 인증서 오류가 나면 서버 인증서를 PC의 신뢰할 수 있는 루트 인증서로 등록합니다.`;
    case 'local':
      return `# LM Studio - mcp.json (Program › Install › Edit mcp.json)\n{\n  "mcpServers": {\n    "${name}": {\n      "url": "${url}",\n` +
        `      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}\n\n` +
        `# Cherry Studio - 설정 › MCP › 추가 › JSON으로 가져오기\n{\n  "mcpServers": {\n    "${name}": {\n      "type": "streamableHttp",\n` +
        `      "baseUrl": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}\n\n` +
        `# Ollama + Open WebUI - 관리자 설정 › 외부 도구 › MCP (Streamable HTTP), URL과 Bearer 키\n\n` +
        `# Jan - 설정 › MCP 서버 › 추가: Claude Desktop 탭과 같은 npx mcp-remote 설정 (command, args, env)\n` +
        `# 도구 호출을 지원하는 모델(qwen3, llama3.1, gpt-oss 등)을 고르세요.`;
    case 'stdio':
      return `# Python으로 띄우는 stdio 브리지 (Node.js가 없는 PC용, 표준 라이브러리만)\ncurl -fsSO ${origin}/api/vlab/mcp/stdio.py\n\n` +
        `{\n  "mcpServers": {\n    "${name}": {\n      "command": "python3",\n      "args": ["/path/stdio.py"],\n` +
        `      "env": { "MOAVI_MCP_URL": "${url}", "MOAVI_MCP_TOKEN": "${token}" }\n    }\n  }\n}\n` +
        `# 자체 서명 인증서: "MOAVI_MCP_CA": "/path/moavi-gateway.crt" 추가`;
  }
}

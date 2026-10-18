import { useEffect, useState } from 'react';
import { isMock } from '../api/client';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';

// 보안 게이트웨이 · 장치 연결 방식: Windows Remote Desktop connects only through an RD Gateway it trusts.
// A browser cannot add to the Windows certificate store, so the portal hands out a small installer
// (.cmd) with the console's certificate inside: it asks for administrator rights once, checks the
// thumbprint and adds the certificate to this computer's Trusted Root store. Done once per PC; this
// browser remembers it per thumbprint (a new server certificate asks again).

export const CERT_URL = '/moavi-gateway.crt';

export type GatewayCert = { pem: string; b64: string; thumbprint: string };

const doneKey = (thumb: string) => `moavi.gwcert.${thumb}`;

export function certDone(c: GatewayCert | null) {
  try { return !!c && localStorage.getItem(doneKey(c.thumbprint)) === '1'; } catch { return false; }
}
export function markCertDone(c: GatewayCert | null) {
  try { if (c) localStorage.setItem(doneKey(c.thumbprint), '1'); } catch { /* this browser only */ }
}

async function sha1Hex(bytes: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// the certificate the console serves (vlab-proxy /moavi-gateway.crt), or null when it is not there
export async function loadGatewayCert(url = CERT_URL): Promise<GatewayCert | null> {
  try {
    let pem: string;
    if (isMock) {
      pem = '-----BEGIN CERTIFICATE-----\nTU9BVkktREVTSy1NT0NLLUNFUlRJRklDQVRF\n-----END CERTIFICATE-----\n';
    } else {
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return null;
      pem = await r.text();
    }
    const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
    if (!m) return null;
    const b64 = m[1].replace(/\s+/g, '');
    const der = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return { pem, b64, thumbprint: await sha1Hex(der) };
  } catch {
    return null;
  }
}

// Windows batch file: elevates itself, installs only a certificate with exactly this thumbprint
export function installerCmd(c: GatewayCert) {
  const ps = [
    `$b=[Convert]::FromBase64String('${c.b64}')`,
    '$c=[Security.Cryptography.X509Certificates.X509Certificate2]::new($b)',
    `if ($c.Thumbprint -ne '${c.thumbprint}') { Write-Host 'The certificate does not match - nothing installed.'; exit 2 }`,
    "$s=[Security.Cryptography.X509Certificates.X509Store]::new('Root','LocalMachine')",
    "$s.Open('ReadWrite'); $s.Add($c); $s.Close()",
    "Write-Host ''; Write-Host 'Installed (this computer, Trusted Root):' $c.Subject; Write-Host 'Thumbprint:' $c.Thumbprint",
  ].join('; ');
  return [
    '@echo off',
    'rem MOAVI Desk - installs the security gateway certificate for Windows Remote Desktop',
    `rem (this computer, Trusted Root Certification Authorities). Thumbprint ${c.thumbprint}`,
    'net session >nul 2>&1',
    'if errorlevel 1 (',
    "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    '  exit /b',
    ')',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

export function downloadInstaller(c: GatewayCert) {
  const url = URL.createObjectURL(new Blob([installerCmd(c)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'moavi-gateway-install.cmd'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// asked before the first devices-route .rdp on this PC: install, then get the .rdp
export function GatewayCertDialog({ cert, onClose, onRdp }: { cert: GatewayCert | null; onClose: () => void; onRdp: () => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  return (
    <Dialog open title={L('게이트웨이 인증서 설치 (이 PC에서 처음 한 번)', 'Gateway certificate (once on this PC)')}
      onClose={onClose} onSubmit={() => { markCertDone(cert); onRdp(); }} submitLabel={L('설치했습니다 · RDP 파일 받기', 'Installed - get the RDP file')}>
      <p className="muted small">{L('Windows 원격 데스크톱은 믿을 수 있는 게이트웨이에만 접속합니다.', 'Windows Remote Desktop connects only through a gateway it trusts.')}</p>
      <ol className="cert-steps">
        <li>
          <button type="button" className="btn" disabled={!cert} onClick={() => cert && downloadInstaller(cert)}>
            <Icon name="download" size={16} />{L('설치 도우미 받기', 'Get the installer')}</button>
          <span className="muted small">{L('받은 moavi-gateway-install.cmd를 실행하고 관리자 확인에서 "예"를 누릅니다. "Windows의 PC 보호"가 뜨면 추가 정보 → 실행.',
            'Run moavi-gateway-install.cmd and answer "Yes" to the administrator prompt. If SmartScreen shows, More info → Run anyway.')}</span>
        </li>
        <li><span className="muted small">{L('"Installed"가 나오면 아래 버튼으로 RDP 파일을 받아 바로 엽니다.', 'When it says "Installed", get the RDP file below and open it.')}</span></li>
      </ol>
      <p className="muted small">
        {cert ? <>{L('지문', 'Thumbprint')} <code className="nowrap">{cert.thumbprint}</code> · </> : <>{L('인증서를 읽지 못했습니다. ', 'Could not read the certificate. ')}</>}
        <a href={CERT_URL} download>{L('인증서만 받기', 'Certificate only')}</a>
        {L(' (직접 설치: 로컬 컴퓨터 → 신뢰할 수 있는 루트 인증 기관)', ' (by hand: Local Machine → Trusted Root Certification Authorities)')}
      </p>
    </Dialog>
  );
}

// the thumbprint, for the admin page
export function useGatewayCert() {
  const [c, setC] = useState<GatewayCert | null | undefined>(undefined);
  useEffect(() => { let live = true; void loadGatewayCert().then((x) => { if (live) setC(x); }); return () => { live = false; }; }, []);
  return c;
}
